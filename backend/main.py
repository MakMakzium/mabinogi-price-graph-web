import json
import os
import re
import time
import asyncio
from typing import Dict, List, Optional, Tuple

import aiohttp
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_logic import get_price_graph_data, CATEGORICAL_TYPES, COLOR_TYPES
from api_client import get_headers

app = FastAPI()

# CORS 설정
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 옵션 캐시 ──────────────────────────────────────────────────────────────────

_options_cache: List[str] = []

# ── 서브옵션 라이브 캐시 ────────────────────────────────────────────────────────

# {option_type: (timestamp, [stat_names])}
_sub_options_cache: Dict[str, Tuple[float, List[str]]] = {}
_SUB_OPTIONS_TTL = 3600  # 1시간

# ── 아이템 이름 검색 캐시 ───────────────────────────────────────────────────────

# {keyword: (timestamp, [item_names])}
_item_names_cache: Dict[str, Tuple[float, List[str]]] = {}
_ITEM_NAMES_TTL = 300  # 5분

# 슬롯 타입별 우선 탐색 카테고리 (Nexon API first_category 값)
_SLOT_TYPE_CATEGORIES: Dict[str, List[str]] = {
    "세공 옵션":       ["검", "한손 장비", "중갑옷", "경갑옷", "천옷", "모자/가발"],
    "무리아스 유물":    ["유물"],
    "에코스톤 각성 능력": ["에코스톤"],
    "사용 효과":       ["한손 장비", "중갑옷"],
    "세트 효과":       ["중갑옷", "경갑옷"],
    "조미료 효과":     ["음식", "허브"],
}
_DEFAULT_SLOT_CATEGORIES = ["검", "중갑옷", "에코스톤", "유물"]

# 아이템 이름 없이 카테고리 전체 검색을 허용하는 옵션 타입
_EMPTY_SEARCH_CATEGORIES: Dict[str, List[str]] = {
    "인챈트": ["인챈트 스크롤"],
    "색상":   ["염색 앰플"],
}


def _extract_stat_name(option_value: str) -> Optional[str]:
    """'마법 공격력 20 레벨' → '마법 공격력'
    숫자 앞의 텍스트를 stat명으로 추출하고, 끝의 여는 괄호/공백/구분자를 제거합니다.
    예: '그볼트 마스터리 대미지(20 레벨' → '그볼트 마스터리 대미지'
    """
    m = re.search(r'\d+', option_value)
    if m and m.start() > 0:
        raw = option_value[:m.start()]
        name = re.sub(r'[\s(（\[「『\-_]+$', '', raw).strip()
        return name or None
    return None


async def _fetch_slot_sub_options(option_type: str) -> List[str]:
    """Nexon API를 순회하며 해당 옵션 타입의 스탯 이름을 수집합니다."""
    stats: set = set()
    categories = _SLOT_TYPE_CATEGORIES.get(option_type, _DEFAULT_SLOT_CATEGORIES)

    async with aiohttp.ClientSession() as session:
        for category in categories:
            for page in range(1, 4):  # 카테고리당 최대 3페이지
                try:
                    async with session.get(
                        "https://open.api.nexon.com/mabinogi/v1/auction/list",
                        headers=get_headers(),
                        params={"first_category": category, "page": page},
                    ) as resp:
                        if resp.status == 429:
                            await asyncio.sleep(3)
                            continue
                        if resp.status != 200:
                            break
                        data = await resp.json()
                        items = data.get("auction_item", [])
                        if not items:
                            break

                        for item in items:
                            for opt in (item.get("item_option") or []):
                                if opt.get("option_type") != option_type:
                                    continue
                                sub = str(opt.get("option_sub_type") or "")
                                val = str(opt.get("option_value") or "")
                                if sub.strip().isdigit():
                                    # 슬롯 번호 타입: option_value 앞부분에서 스탯명 추출
                                    stat = _extract_stat_name(val)
                                    if stat:
                                        stats.add(stat)
                                elif sub and sub.lower() != "none":
                                    stats.add(sub)
                                else:
                                    # option_sub_type이 없는 타입(에코스톤 각성 능력 등):
                                    # option_value 앞부분에서 스탯명 추출
                                    stat = _extract_stat_name(val)
                                    if stat:
                                        stats.add(stat)

                        if len(items) < 500:
                            break
                        await asyncio.sleep(0.1)

                except Exception as e:
                    print(f"[sub-options] {option_type} / {category} p{page}: {e}", flush=True)
                    break

    return sorted(stats)


# ── 스타트업 ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
def load_options():
    """서버 시작 시 item_options.json 파일을 읽어 캐시에 저장합니다."""
    global _options_cache
    options_path = os.path.join(os.path.dirname(__file__), "scraper", "item_options.json")
    try:
        with open(options_path, "r", encoding="utf-8") as f:
            _options_cache = json.load(f)
        print(f"✅ {len(_options_cache)}개의 아이템 옵션을 성공적으로 로드했습니다.", flush=True)
    except FileNotFoundError:
        print("⚠️ 'item_options.json' 파일을 찾을 수 없습니다. 옵션 수집 스크립트를 먼저 실행해주세요.", flush=True)
    except Exception as e:
        print(f"❌ 아이템 옵션 로드 중 오류 발생: {e}", flush=True)


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"message": "마비노기 옵션별 가격 그래프 API"}


@app.get("/categories")
def get_categories() -> List[str]:
    """category.txt의 카테고리 목록을 반환합니다."""
    path = os.path.join(os.path.dirname(__file__), "scraper", "category.txt")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return [line.strip() for line in f if line.strip() and not line.startswith('#')]
    except FileNotFoundError:
        return []


@app.get("/options")
def get_options() -> Dict[str, List[str]]:
    """옵션을 타입별로 그룹핑하여 반환합니다."""
    grouped: Dict[str, List[str]] = {}
    for opt in _options_cache:
        if '|' in opt:
            opt_type, sub_type = opt.split('|', 1)
            grouped.setdefault(opt_type, []).append(sub_type)
        else:
            grouped.setdefault(opt, [])
    return grouped


@app.get("/sub-options")
async def get_sub_options(option_type: str):
    """
    슬롯 타입 옵션의 스탯 이름 목록을 반환합니다.
    item_options.json에 유효한 데이터가 있으면 그걸 사용하고,
    숫자 슬롯(1/2/3)만 있거나 비어 있으면 Nexon API를 직접 조회합니다.
    결과는 1시간 동안 메모리 캐시됩니다.
    """
    now = time.time()

    # 1. 메모리 캐시 확인 (여는 괄호로 끝나는 오염 데이터는 무효화)
    if option_type in _sub_options_cache:
        ts, data = _sub_options_cache[option_type]
        has_dirty = any(s.endswith('(') or s.endswith('（') for s in data)
        if now - ts < _SUB_OPTIONS_TTL and not has_dirty:
            return {"stats": data}
        # 오염됐으면 캐시 삭제 후 재조회
        del _sub_options_cache[option_type]

    # 2. item_options.json의 정적 데이터 확인 (숫자가 아닌 서브타입만)
    static_subs = [
        opt[len(option_type) + 1:]
        for opt in _options_cache
        if opt.startswith(f"{option_type}|")
        and not opt[len(option_type) + 1:].strip().isdigit()
    ]
    if static_subs:
        result = sorted(set(static_subs))
        _sub_options_cache[option_type] = (now, result)
        return {"stats": result}

    # 3. Nexon API 라이브 조회
    print(f"[sub-options] 라이브 조회: {option_type}", flush=True)
    stats = await _fetch_slot_sub_options(option_type)
    _sub_options_cache[option_type] = (now, stats)
    return {"stats": stats}


@app.get("/search-items")
async def search_items(keyword: str):
    """키워드로 아이템 이름 목록을 반환합니다 (자동완성용)."""
    if not keyword or len(keyword.strip()) < 2:
        return {"names": []}

    kw = keyword.strip()
    now = time.time()

    if kw in _item_names_cache:
        ts, cached = _item_names_cache[kw]
        if now - ts < _ITEM_NAMES_TTL:
            return {"names": cached}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://open.api.nexon.com/mabinogi/v1/auction/keyword-search",
                headers=get_headers(),
                params={"keyword": kw},
            ) as resp:
                if resp.status != 200:
                    return {"names": []}
                data = await resp.json()
                items = data.get("auction_item", [])
                seen: List[str] = []
                seen_set: set = set()
                for item in items:
                    name = item.get("item_name", "")
                    if name and name not in seen_set:
                        seen_set.add(name)
                        seen.append(name)
                _item_names_cache[kw] = (now, seen)
                return {"names": seen}
    except Exception as e:
        print(f"[search-items] 오류: {e}", flush=True)
        return {"names": []}


@app.get("/graph-data")
async def get_graph_data_endpoint(
    option_id: str,
    item_name: str = "",
    category: str = "",
    and_options: Optional[str] = None,
):
    # 구분자로 세미콜론(;) 사용 — RGB 값(0,0,0)에 콤마가 포함되므로
    and_list = [o.strip() for o in and_options.split(';') if o.strip()] if and_options else []

    categories: Optional[List[str]] = None
    if category.strip():
        # 명시적 카테고리 검색
        categories = [category.strip()]
    elif not item_name.strip():
        # 이름도 카테고리도 없으면 허용된 타입(인챈트·색상)인지 확인
        opt_type = option_id.split('|')[0]
        categories = _EMPTY_SEARCH_CATEGORIES.get(opt_type)
        if not categories:
            return {"error": "이 옵션 타입은 아이템 이름 또는 카테고리가 필요합니다."}

    data = await get_price_graph_data(item_name.strip(), option_id, and_list, categories=categories)
    return data
