"""
경매장 카테고리를 순회하며 고유한 아이템 옵션 목록을 수집합니다.
봇의 api.py 구조를 참고하여 NEXON_API_KEYS 복수 키 순환을 지원합니다.
"""
import asyncio
import gc
import json
import os
import sys
from typing import Set

import aiohttp

# 상위 디렉터리(backend/)를 import 경로에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api_client import get_headers

# 동시 요청 수 제한 (메모리 및 속도 제한 방지)
MAX_CONCURRENT_TASKS = 3


def load_categories() -> list:
    category_file_path = os.path.join(os.path.dirname(__file__), "category.txt")
    try:
        with open(category_file_path, "r", encoding="utf-8") as f:
            categories = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        print(f"카테고리 {len(categories)}개 로드 완료.")
        return categories
    except FileNotFoundError:
        print(f"[Error] 카테고리 파일 '{category_file_path}'을 찾을 수 없습니다.")
        return []


async def worker_collect_options(
    session: aiohttp.ClientSession,
    category: str,
    semaphore: asyncio.Semaphore,
) -> Set[str]:
    """카테고리 내 모든 페이지를 순회하며 고유 옵션을 수집합니다."""
    async with semaphore:
        print(f"카테고리 '{category}' 수집 시작...")
        category_options: Set[str] = set()
        item_count = 0
        current_page = 0

        while True:
            current_page += 1
            url = "https://open.api.nexon.com/mabinogi/v1/auction/list"
            params = {"first_category": category, "page": current_page}

            try:
                async with session.get(url, headers=get_headers(), params=params) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        items_on_page = data.get("auction_item", [])

                        if not items_on_page:
                            print(f"  - '{category}' 더 이상 아이템 없음.")
                            break

                        item_count += len(items_on_page)

                        for item in items_on_page:
                            for option in (item.get("item_option") or []):
                                opt_type = option.get("option_type")
                                opt_sub_type = option.get("option_sub_type")
                                if not opt_type:
                                    continue
                                if opt_sub_type and str(opt_sub_type).lower() != 'none':
                                    category_options.add(f"{opt_type}|{opt_sub_type}")
                                else:
                                    category_options.add(opt_type)

                        if len(items_on_page) < 500:
                            print(f"  - '{category}' 수집 완료.")
                            break

                        del items_on_page, data
                        await asyncio.sleep(0.1)

                    elif resp.status == 429:
                        print(f"  속도 제한 초과 - '{category}' 페이지 {current_page}. 5초 후 재시도...")
                        await asyncio.sleep(5)
                        current_page -= 1
                        continue

                    else:
                        print(f"  - '{category}' 페이지 {current_page} 오류: 상태 {resp.status}")
                        break

            except Exception as e:
                print(f"  - '{category}' 페이지 {current_page} 예외: {e}")
                break

        print(f"카테고리 '{category}': 아이템 {item_count}개, 고유 옵션 {len(category_options)}개")
        gc.collect()
        return category_options


async def collect_all_options():
    """모든 카테고리에서 고유 옵션을 수집하고 item_options.json에 저장합니다."""
    final_unique_options: Set[str] = set()
    categories = load_categories()
    if not categories:
        print("수집할 카테고리가 없습니다.")
        return

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT_TASKS, force_close=True)

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [worker_collect_options(session, cat, semaphore) for cat in categories]
        results = await asyncio.gather(*tasks)
        for opts in results:
            final_unique_options.update(opts)

    print(f"\n전체 고유 옵션: {len(final_unique_options)}개")

    output_path = os.path.join(os.path.dirname(__file__), "item_options.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(sorted(final_unique_options), f, ensure_ascii=False, indent=2)
    print(f"'{output_path}'에 저장 완료.")


if __name__ == "__main__":
    asyncio.run(collect_all_options())
