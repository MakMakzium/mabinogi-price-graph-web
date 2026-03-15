"""
봇의 option_transformer.py 파싱 로직을 참고한 API 로직 모듈.

옵션 타입 분류:
  - 색상 타입 (COLOR_TYPES): option_value가 "(R,G,B)" 형태
    → 색상별 최저가를 반환 (type: "color")
  - 수치 타입 (나머지): option_value에서 숫자를 추출
    → 수치별 최저가를 반환 (type: "numeric")

세공 옵션 처리:
  option_type="세공 옵션", option_sub_type="1"/"2"/"3" (슬롯 번호),
  option_value="마법 공격력 20 레벨" 형태로 API에서 옵니다.
  → VALUE_AS_SUBTYPE_TYPES 에 등록된 타입은 option_value 텍스트 앞부분으로 매칭합니다.

AND 조건 포맷:
  세미콜론(;) 구분: "타입|서브타입;타입|서브타입|값"
  색상 AND 조건에는 값이 포함됩니다: "아이템 색상|파트 A|0,0,0"
"""
import asyncio
import re
import aiohttp
from typing import List, Dict, Any, Optional, Tuple

from api_client import get_headers

# 슬롯 번호가 sub_type인 타입 (option_value 텍스트 앞부분을 stat_name으로 사용)
VALUE_AS_SUBTYPE_TYPES = {"세공 옵션"}

# 색상 옵션 타입 — option_value가 "(R,G,B)" 형태
COLOR_TYPES = {"아이템 색상", "색상"}


# ── RGB 유틸리티 ───────────────────────────────────────────────────────────────

def parse_rgb(value_str: str) -> Optional[Tuple[int, int, int]]:
    """
    "(0,0,0)", "0, 0, 0", "2 7 21" 등에서 (R, G, B) 튜플을 추출합니다.
    유효 범위(0~255)를 벗어나면 None 반환.
    """
    numbers = re.findall(r'\d+', value_str)
    if len(numbers) >= 3:
        r, g, b = int(numbers[0]), int(numbers[1]), int(numbers[2])
        if all(0 <= v <= 255 for v in (r, g, b)):
            return r, g, b
    return None


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


# ── 수치 추출 ──────────────────────────────────────────────────────────────────

def extract_numeric_value(option: Dict[str, Any]) -> Optional[int]:
    """
    봇의 option_transformer.extract_option_parts 로직을 참고.
    option_value에서 숫자를 추출합니다.
    예) "마법 공격력 20 레벨" → 20
    """
    option_value_str = str(option.get("option_value", ""))
    match = re.search(r'(\d+)\s*(?:레벨|단계|증가)?', option_value_str)
    if match:
        return int(match.group(1))

    # option_value2에서도 시도
    v2 = str(option.get("option_value2", ""))
    if v2 and v2 != "None":
        m2 = re.search(r'\d+', v2)
        if m2:
            return int(m2.group())

    return None


# ── 옵션 식별자 파싱 ───────────────────────────────────────────────────────────

def _parse_option_id(option_id: str) -> Tuple[str, Optional[str]]:
    """'타입|서브타입' 또는 '타입' → (타입, 서브타입)"""
    parts = option_id.split('|', 1)
    return parts[0], (parts[1] if len(parts) > 1 else None)


def _parse_condition(condition: str) -> Tuple[str, Optional[str], Optional[str]]:
    """
    AND 조건 문자열을 (타입, 서브타입, 값) 튜플로 파싱합니다.
    - "세공 옵션|마법 공격력"     → ("세공 옵션", "마법 공격력", None)
    - "아이템 색상|파트 A|0,0,0" → ("아이템 색상", "파트 A", "0,0,0")
    """
    parts = condition.split('|', 2)
    return (
        parts[0],
        parts[1] if len(parts) > 1 else None,
        parts[2] if len(parts) > 2 else None,
    )


# ── 옵션 매칭 ──────────────────────────────────────────────────────────────────

def _matches_option(
    opt: Dict,
    opt_type: str,
    opt_sub_type: Optional[str],
    opt_value: Optional[str] = None,
) -> bool:
    """
    단일 option 객체가 (타입, 서브타입, 값) 조건에 맞는지 확인합니다.
    """
    if opt.get("option_type") != opt_type:
        return False

    if opt_sub_type is not None:
        if opt_type in VALUE_AS_SUBTYPE_TYPES:
            # 세공 옵션: option_value 텍스트 앞부분으로 매칭
            if not str(opt.get("option_value", "")).startswith(opt_sub_type):
                return False
        else:
            if opt.get("option_sub_type") != opt_sub_type:
                return False

    if opt_value is not None:
        raw = str(opt.get("option_value", ""))
        if opt_type in COLOR_TYPES:
            # 색상: RGB 값 비교
            if parse_rgb(raw) != parse_rgb(opt_value):
                return False
        else:
            if raw != opt_value:
                return False

    return True


def _item_has_option(
    item_options: List[Dict],
    opt_type: str,
    opt_sub_type: Optional[str],
    opt_value: Optional[str] = None,
) -> bool:
    return any(_matches_option(o, opt_type, opt_sub_type, opt_value) for o in item_options)


def _find_numeric_value(
    item_options: List[Dict],
    opt_type: str,
    opt_sub_type: Optional[str],
) -> Optional[int]:
    for opt in item_options:
        if _matches_option(opt, opt_type, opt_sub_type):
            return extract_numeric_value(opt)
    return None


# ── Nexon API 호출 ─────────────────────────────────────────────────────────────

async def search_item_by_name(
    session: aiohttp.ClientSession,
    item_name: str,
) -> List[Dict[str, Any]]:
    url = "https://open.api.nexon.com/mabinogi/v1/auction/keyword-search"
    params = {"keyword": item_name}
    all_items: List[Dict[str, Any]] = []

    while True:
        try:
            async with session.get(url, headers=get_headers(), params=params) as resp:
                if resp.status != 200:
                    print(f"아이템 '{item_name}' 검색 실패 - {resp.status}", flush=True)
                    break
                data = await resp.json()
                all_items.extend(data.get("auction_item", []))
                if len(all_items) >= 50000:
                    break
                next_cursor = data.get("next_cursor")
                if next_cursor:
                    params["cursor"] = next_cursor
                    await asyncio.sleep(0.1)
                else:
                    break
        except Exception as e:
            print(f"아이템 '{item_name}' 검색 중 오류: {e}", flush=True)
            break

    return all_items


# ── 그래프 데이터 생성 ─────────────────────────────────────────────────────────

async def get_price_graph_data(
    item_name: str,
    option_identifier: str,
    and_options: List[str] = None,
) -> Dict[str, Any]:
    """
    - option_identifier: 그래프 기준 옵션
    - and_options: AND 조건 목록 (세미콜론 분리 후 전달됨)
      색상 조건 예: "아이템 색상|파트 A|0,0,0"
    """
    primary_type, primary_sub_type = _parse_option_id(option_identifier)

    and_filters: List[Tuple[str, Optional[str], Optional[str]]] = []
    if and_options:
        for cond in and_options:
            and_filters.append(_parse_condition(cond))

    async with aiohttp.ClientSession() as session:
        all_items = await search_item_by_name(session, item_name)

    if not all_items:
        return {"error": "아이템을 찾을 수 없습니다."}

    # AND 조건 체크 공통 함수
    def passes_and_filters(item_options: List[Dict]) -> bool:
        return all(
            _item_has_option(item_options, t, s, v)
            for t, s, v in and_filters
        )

    # ── 색상 그래프 ────────────────────────────────────────────────────────────
    if primary_type in COLOR_TYPES:
        price_by_color: Dict[str, int] = {}

        for item in all_items:
            item_options = item.get("item_option") or []
            if and_filters and not passes_and_filters(item_options):
                continue

            for opt in item_options:
                if not _matches_option(opt, primary_type, primary_sub_type):
                    continue
                rgb = parse_rgb(str(opt.get("option_value", "")))
                if rgb:
                    key = f"{rgb[0]},{rgb[1]},{rgb[2]}"
                    price = item.get("auction_price_per_unit", 0)
                    if key not in price_by_color or price < price_by_color[key]:
                        price_by_color[key] = price
                break

        if not price_by_color:
            return {"error": "해당 조건을 만족하는 아이템 매물을 찾을 수 없습니다."}

        sorted_colors = sorted(price_by_color.items(), key=lambda x: x[1])

        return {
            "type": "color",
            "colors": [
                {
                    "r": int(k.split(',')[0]),
                    "g": int(k.split(',')[1]),
                    "b": int(k.split(',')[2]),
                    "hex": rgb_to_hex(int(k.split(',')[0]), int(k.split(',')[1]), int(k.split(',')[2])),
                    "price": v,
                }
                for k, v in sorted_colors
            ],
            "item_name": item_name,
            "option_name": option_identifier,
        }

    # ── 수치 그래프 ────────────────────────────────────────────────────────────
    price_by_value: Dict[int, int] = {}

    for item in all_items:
        item_options = item.get("item_option") or []
        if and_filters and not passes_and_filters(item_options):
            continue

        numeric_value = _find_numeric_value(item_options, primary_type, primary_sub_type)
        if numeric_value is None:
            continue

        price = item.get("auction_price_per_unit", 0)
        if numeric_value not in price_by_value or price < price_by_value[numeric_value]:
            price_by_value[numeric_value] = price

    if not price_by_value:
        return {"error": "해당 조건을 만족하는 아이템 매물을 찾을 수 없습니다."}

    sorted_data = sorted(price_by_value.items())

    return {
        "type": "numeric",
        "labels": [row[0] for row in sorted_data],
        "data": [row[1] for row in sorted_data],
        "item_name": item_name,
        "option_name": option_identifier,
    }
