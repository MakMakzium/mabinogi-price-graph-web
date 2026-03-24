"""
봇의 option_transformer.py 파싱 로직을 참고한 API 로직 모듈.

옵션 매칭 전략 (이중 매칭):
  item_options.json에서 수집된 서브타입은 두 가지 출처가 있습니다:
    1. API의 option_sub_type 그대로 (예: 인챈트|접두, 에르그|A)
    2. 슬롯 번호 타입에서 option_value 텍스트 앞부분 추출 (예: 세공 옵션|마법 공격력)

  따라서 매칭 시 두 방법을 모두 시도합니다:
    - option_sub_type 직접 일치  OR
    - option_value 텍스트 앞부분 일치

색상 타입 (COLOR_TYPES):
  option_value가 "(R,G,B)" 형태 → type: "color" 응답으로 분기
"""
import asyncio
import re
import aiohttp
from typing import AsyncIterator, List, Dict, Any, Optional, Tuple

from api_client import get_headers

COLOR_TYPES = {"아이템 색상", "색상"}

# option_value 자체가 이름(문자열)이어서 수치 그래프 대신 이름 → 가격 비교로 표시할 타입
CATEGORICAL_TYPES = {"인챈트"}


# ── RGB 유틸리티 ───────────────────────────────────────────────────────────────

def parse_rgb(value_str: str) -> Optional[Tuple[int, int, int]]:
    nums = re.findall(r'\d+', value_str)
    if len(nums) >= 3:
        r, g, b = int(nums[0]), int(nums[1]), int(nums[2])
        if all(0 <= v <= 255 for v in (r, g, b)):
            return r, g, b
    return None


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


# ── 수치 추출 ──────────────────────────────────────────────────────────────────

def extract_numeric_value(option: Dict[str, Any]) -> Optional[int]:
    val = str(option.get("option_value", ""))
    m = re.search(r'(\d+)\s*(?:레벨|단계|증가)?', val)
    if m:
        return int(m.group(1))
    v2 = str(option.get("option_value2", ""))
    if v2 and v2 != "None":
        m2 = re.search(r'\d+', v2)
        if m2:
            return int(m2.group())
    return None


# ── 파싱 ──────────────────────────────────────────────────────────────────────

def _parse_option_id(s: str) -> Tuple[str, Optional[str]]:
    parts = s.split('|', 1)
    return parts[0], (parts[1] if len(parts) > 1 else None)


def _parse_condition(s: str) -> Tuple[str, Optional[str], Optional[str]]:
    """'타입|서브타입|값' 파싱. 값은 색상 AND 조건에서만 사용."""
    parts = s.split('|', 2)
    return (
        parts[0],
        parts[1] if len(parts) > 1 else None,
        parts[2] if len(parts) > 2 else None,
    )


# ── 이중 매칭 ──────────────────────────────────────────────────────────────────

def _matches_option(
    opt: Dict,
    opt_type: str,
    opt_sub_type: Optional[str],
    opt_value: Optional[str] = None,
) -> bool:
    if opt.get("option_type") != opt_type:
        return False

    if opt_sub_type is not None:
        api_sub   = opt.get("option_sub_type") or ""
        val_str   = str(opt.get("option_value", ""))

        direct_match = (api_sub == opt_sub_type)
        prefix_match = val_str.startswith(opt_sub_type)

        if not (direct_match or prefix_match):
            return False

    if opt_value is not None:
        raw = str(opt.get("option_value", ""))
        if opt_type in COLOR_TYPES:
            if parse_rgb(raw) != parse_rgb(opt_value):
                return False
        else:
            if raw != opt_value:
                return False

    return True


def _item_has_option(
    item_opts: List[Dict],
    t: str, s: Optional[str], v: Optional[str] = None,
) -> bool:
    return any(_matches_option(o, t, s, v) for o in item_opts)


def _find_numeric_value(
    item_opts: List[Dict],
    opt_type: str,
    opt_sub_type: Optional[str],
) -> Optional[int]:
    for opt in item_opts:
        if _matches_option(opt, opt_type, opt_sub_type):
            return extract_numeric_value(opt)
    return None


# ── Nexon API 스트리밍 ─────────────────────────────────────────────────────────

async def _fetch_category_page(
    session: aiohttp.ClientSession,
    category: str,
    page: int,
    sem: asyncio.Semaphore,
) -> List[Dict[str, Any]]:
    url = "https://open.api.nexon.com/mabinogi/v1/auction/list"
    async with sem:
        for attempt in range(3):
            try:
                async with session.get(
                    url, headers=get_headers(),
                    params={"first_category": category, "page": page},
                ) as resp:
                    if resp.status == 429:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    if resp.status != 200:
                        return []
                    data = await resp.json()
                    return data.get("auction_item", [])
            except Exception as e:
                print(f"[category search] {category} p{page}: {e}", flush=True)
        return []


async def _iter_items_by_name(
    session: aiohttp.ClientSession,
    item_name: str,
) -> AsyncIterator[Dict[str, Any]]:
    """키워드 검색 — 아이템을 한 건씩 yield하여 메모리에 쌓지 않습니다."""
    url = "https://open.api.nexon.com/mabinogi/v1/auction/keyword-search"
    params: Dict = {"keyword": item_name}
    total = 0

    while True:
        data = None
        for attempt in range(3):
            try:
                async with session.get(url, headers=get_headers(), params=params) as resp:
                    if resp.status == 429:
                        wait = 2 ** attempt
                        print(f"검색 속도 제한 '{item_name}' (시도 {attempt+1}), {wait}초 대기", flush=True)
                        await asyncio.sleep(wait)
                        continue
                    if resp.status != 200:
                        print(f"검색 실패 '{item_name}' - {resp.status}", flush=True)
                        return
                    data = await resp.json()
                    break
            except Exception as e:
                print(f"검색 오류 '{item_name}' (시도 {attempt+1}): {e}", flush=True)
                if attempt < 2:
                    await asyncio.sleep(1)
        if data is None:
            return

        items = data.get("auction_item", [])
        if not items:
            break
        for item in items:
            yield item
        total += len(items)
        if total >= 50000:
            break
        cur = data.get("next_cursor")
        if cur:
            params["cursor"] = cur
            await asyncio.sleep(0.4)
        else:
            break


async def _iter_items_by_categories(
    session: aiohttp.ClientSession,
    categories: List[str],
) -> AsyncIterator[Dict[str, Any]]:
    """카테고리 검색 — 5페이지씩 병렬 fetch하고 즉시 yield합니다."""
    sem = asyncio.Semaphore(5)

    for category in categories:
        first_page = await _fetch_category_page(session, category, 1, sem)
        for item in first_page:
            yield item
        if len(first_page) < 500:
            continue

        page = 2
        while True:
            pages_to_fetch = list(range(page, page + 5))
            tasks = [_fetch_category_page(session, category, p, sem) for p in pages_to_fetch]
            results = await asyncio.gather(*tasks)

            done = False
            for items in results:
                for item in items:
                    yield item
                if len(items) < 500:
                    done = True
                    break

            page += 5
            if done or page > 41:
                break


# ── 그래프 데이터 생성 ─────────────────────────────────────────────────────────

async def get_price_graph_data(
    item_name: str,
    option_identifier: str,
    and_options: List[str] = None,
    categories: List[str] = None,
) -> Dict[str, Any]:
    primary_type, primary_sub = _parse_option_id(option_identifier)

    and_filters: List[Tuple[str, Optional[str], Optional[str]]] = [
        _parse_condition(c) for c in (and_options or [])
    ]

    def passes(item_opts: List[Dict]) -> bool:
        return all(_item_has_option(item_opts, t, s, v) for t, s, v in and_filters)

    # 타입별 집계 딕셔너리 (아이템 원본은 메모리에 보관하지 않음)
    price_by_color: Dict[str, int] = {}
    price_by_name:  Dict[str, int] = {}
    price_by_val:   Dict[int, int] = {}
    found_any = False

    async with aiohttp.ClientSession() as session:
        if item_name:
            item_iter = _iter_items_by_name(session, item_name)
        elif categories:
            item_iter = _iter_items_by_categories(session, categories)
        else:
            return {"error": "아이템 이름을 입력해주세요."}

        async for item in item_iter:
            opts  = item.get("item_option") or []
            price = item.get("auction_price_per_unit", 0)

            if and_filters and not passes(opts):
                continue

            if primary_type in COLOR_TYPES:
                for opt in opts:
                    if not _matches_option(opt, primary_type, primary_sub):
                        continue
                    rgb = parse_rgb(str(opt.get("option_value", "")))
                    if rgb:
                        key = f"{rgb[0]},{rgb[1]},{rgb[2]}"
                        if key not in price_by_color or price < price_by_color[key]:
                            price_by_color[key] = price
                        found_any = True
                    break

            elif primary_type in CATEGORICAL_TYPES:
                for opt in opts:
                    if not _matches_option(opt, primary_type, primary_sub):
                        continue
                    name = str(opt.get("option_value") or "").strip()
                    if not name or name.lower() == "none":
                        continue
                    if name not in price_by_name or price < price_by_name[name]:
                        price_by_name[name] = price
                    found_any = True
                    break

            else:
                nv = _find_numeric_value(opts, primary_type, primary_sub)
                if nv is not None:
                    if nv not in price_by_val or price < price_by_val[nv]:
                        price_by_val[nv] = price
                    found_any = True

    if not found_any:
        return {"error": "해당 조건을 만족하는 아이템 매물을 찾을 수 없습니다."}

    # ── 색상 결과 ────────────────────────────────────────────────────────────
    if primary_type in COLOR_TYPES:
        sorted_colors = sorted(price_by_color.items(), key=lambda x: x[1])
        return {
            "type": "color",
            "colors": [
                {
                    "r": int(k.split(',')[0]),
                    "g": int(k.split(',')[1]),
                    "b": int(k.split(',')[2]),
                    "hex": rgb_to_hex(
                        int(k.split(',')[0]),
                        int(k.split(',')[1]),
                        int(k.split(',')[2]),
                    ),
                    "price": v,
                }
                for k, v in sorted_colors
            ],
            "item_name": item_name,
            "option_name": option_identifier,
        }

    # ── 카테고리형 결과 ──────────────────────────────────────────────────────
    if primary_type in CATEGORICAL_TYPES:
        sorted_data = sorted(price_by_name.items(), key=lambda x: x[1])
        return {
            "type": "categorical",
            "labels": [r[0] for r in sorted_data],
            "data":   [r[1] for r in sorted_data],
            "item_name": item_name or "(전체)",
            "option_name": option_identifier,
        }

    # ── 수치 결과 ────────────────────────────────────────────────────────────
    sorted_data = sorted(price_by_val.items())
    return {
        "type": "numeric",
        "labels": [r[0] for r in sorted_data],
        "data":   [r[1] for r in sorted_data],
        "item_name": item_name,
        "option_name": option_identifier,
    }
