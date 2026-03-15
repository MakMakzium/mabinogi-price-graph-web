"""
봇의 option_transformer.py 파싱 로직을 참고한 API 로직 모듈.
"""
import asyncio
import re
import aiohttp
from typing import List, Dict, Any, Optional, Tuple

from api_client import get_headers


# ── 옵션 파싱 ──────────────────────────────────────────────────────────────────

def extract_numeric_value(option: Dict[str, Any]) -> Optional[int]:
    """
    봇의 option_transformer.extract_option_parts 로직을 참고.
    option_value에서 숫자를 추출합니다.
    예) "최대 공격력 20 레벨" → 20
    예) "피어싱 3 레벨"       → 3
    """
    option_value_str = str(option.get("option_value", ""))
    match = re.search(r'(\d+)\s*(?:레벨|단계|증가)?', option_value_str)
    if match:
        return int(match.group(1))

    # option_value2에서도 시도
    option_value2_str = str(option.get("option_value2", ""))
    if option_value2_str and option_value2_str != "None":
        match2 = re.search(r'\d+', option_value2_str)
        if match2:
            return int(match2.group())

    return None


# ── Nexon API 호출 ─────────────────────────────────────────────────────────────

async def search_item_by_name(
    session: aiohttp.ClientSession,
    item_name: str,
) -> List[Dict[str, Any]]:
    """
    keyword-search 엔드포인트로 아이템을 검색합니다.
    cursor 페이지네이션을 지원합니다 (최대 50,000개).
    """
    url = "https://open.api.nexon.com/mabinogi/v1/auction/keyword-search"
    params = {"keyword": item_name}
    all_items: List[Dict[str, Any]] = []

    while True:
        try:
            async with session.get(url, headers=get_headers(), params=params) as resp:
                if resp.status != 200:
                    print(f"아이템 '{item_name}' 검색 실패 - 상태 코드: {resp.status}", flush=True)
                    break
                data = await resp.json()
                chunk = data.get("auction_item", [])
                all_items.extend(chunk)

                if len(all_items) >= 50000:
                    break

                next_cursor = data.get("next_cursor")
                if next_cursor:
                    params["cursor"] = next_cursor
                    await asyncio.sleep(0.1)
                else:
                    break

        except Exception as e:
            print(f"아이템 '{item_name}' 검색 중 오류 발생: {e}", flush=True)
            break

    return all_items


# ── 그래프 데이터 생성 ─────────────────────────────────────────────────────────

async def get_price_graph_data(item_name: str, option_identifier: str) -> Dict[str, Any]:
    """
    특정 아이템과 옵션에 대한 가격 그래프 데이터를 생성합니다.
    option_identifier: '타입|서브타입' 또는 '타입' 형태
    """
    # "타입|서브타입" 또는 "타입" 분리
    parts = option_identifier.split('|', 1)
    opt_type_filter = parts[0]
    opt_sub_type_filter = parts[1] if len(parts) > 1 else None

    # {옵션 수치: 최저가}
    price_by_option_value: Dict[int, int] = {}

    async with aiohttp.ClientSession() as session:
        all_items = await search_item_by_name(session, item_name)

    if not all_items:
        return {"error": "아이템을 찾을 수 없습니다."}

    for item in all_items:
        item_options = item.get("item_option")
        if not item_options:
            continue

        for option in item_options:
            opt_type = option.get("option_type")
            opt_sub_type = option.get("option_sub_type")

            # 옵션 일치 확인
            if opt_sub_type_filter:
                if not (opt_type == opt_type_filter and opt_sub_type == opt_sub_type_filter):
                    continue
            else:
                if opt_type != opt_type_filter:
                    continue

            numeric_value = extract_numeric_value(option)
            if numeric_value is None:
                continue

            price = item.get("auction_price_per_unit", 0)
            if numeric_value not in price_by_option_value or price < price_by_option_value[numeric_value]:
                price_by_option_value[numeric_value] = price
            break  # 아이템당 해당 옵션 하나만 처리

    if not price_by_option_value:
        return {"error": "해당 옵션을 가진 아이템 매물을 찾을 수 없습니다."}

    sorted_data = sorted(price_by_option_value.items())

    return {
        "labels": [row[0] for row in sorted_data],
        "data": [row[1] for row in sorted_data],
        "item_name": item_name,
        "option_name": option_identifier,
    }
