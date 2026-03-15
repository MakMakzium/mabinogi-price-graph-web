import asyncio
import aiohttp
import re
from typing import List, Dict, Any, Optional
from config import NEXON_API_KEY

async def search_item_by_name(session: aiohttp.ClientSession, item_name: str) -> List[Dict[str, Any]]:
    """API를 통해 특정 이름의 아이템을 검색하고 모든 결과를 반환합니다."""
    url = "https://open.api.nexon.com/mabinogi/v1/auction/keyword-search"
    params = {"keyword": item_name}
    try:
        async with session.get(url, params=params) as resp:
            if resp.status == 200:
                data = await resp.json()
                return data.get("auction_item", [])
            else:
                print(f"아이템 '{item_name}' 검색 실패 - 상태 코드: {resp.status}")
                return []
    except Exception as e:
        print(f"아이템 '{item_name}' 검색 중 오류 발생: {e}")
        return []

def extract_numeric_value(option_value: Any) -> Optional[int]:
    """옵션 값에서 숫자만 추출합니다. '레벨', '증가' 등의 문자는 제거합니다."""
    if option_value is None:
        return None
    
    # 문자열로 변환 후, 숫자만 찾기
    s_val = str(option_value)
    match = re.search(r'\d+', s_val)
    if match:
        return int(match.group(0))
    return None

async def get_price_graph_data(item_name: str, option_identifier: str) -> Dict[str, Any]:
    """
    특정 아이템과 옵션에 대한 가격 그래프 데이터를 생성합니다.
    option_identifier는 '타입|서브타입' 또는 '타입' 형태입니다.
    """
    headers = {"x-nxopen-api-key": NEXON_API_KEY}
    
    # 가격 데이터를 저장할 딕셔너리. {옵션값: 최저가}
    price_by_option_value: Dict[int, int] = {}

    async with aiohttp.ClientSession(headers=headers) as session:
        all_items = await search_item_by_name(session, item_name)
        if not all_items:
            return {"error": "아이템을 찾을 수 없습니다."}

        opt_type_filter, opt_sub_type_filter = (option_identifier.split('|') + [None])[:2]

        for item in all_items:
            item_options = item.get("item_option")
            if not item_options:
                continue

            for option in item_options:
                opt_type = option.get("option_type")
                opt_sub_type = option.get("option_sub_type")

                # 사용자가 요청한 옵션과 일치하는지 확인
                match = False
                if opt_sub_type_filter and opt_type == opt_type_filter and opt_sub_type == opt_sub_type_filter:
                    match = True
                elif not opt_sub_type_filter and opt_type == opt_type_filter:
                    match = True
                
                if match:
                    numeric_value = extract_numeric_value(option.get("option_value"))
                    if numeric_value is not None:
                        price = item.get("auction_price_per_unit", 0)
                        
                        # 해당 옵션 값의 최저가 업데이트
                        if numeric_value not in price_by_option_value or price < price_by_option_value[numeric_value]:
                            price_by_option_value[numeric_value] = price
                    break # 한 아이템에서 해당 옵션을 찾으면 다음 아이템으로 넘어감

    if not price_by_option_value:
        return {"error": "해당 옵션을 가진 아이템 매물을 찾을 수 없습니다."}

    # 결과를 옵션 값 기준으로 정렬하여 반환
    sorted_data = sorted(price_by_option_value.items())
    
    # 프론트엔드 차트 라이브러리가 사용하기 쉬운 형태로 가공
    # labels: [10, 11, 12, ...], data: [55000000, 62000000, ...]
    result = {
        "labels": [item[0] for item in sorted_data],
        "data": [item[1] for item in sorted_data],
        "item_name": item_name,
        "option_name": option_identifier
    }

    return result
