"""
경매장 카테고리를 순회하며 고유한 아이템 옵션 목록을 수집합니다.

서브타입 처리 규칙:
  - option_sub_type이 순수 숫자(슬롯 번호)인 경우
    → 슬롯 번호는 의미 없으므로 option_value 텍스트 앞부분을 스탯명으로 추출
    → "세공 옵션|1" (X)  →  "세공 옵션|마법 공격력" (O)
    → 이 규칙은 세공 옵션, 사용 효과, 세트 효과, 조미료 효과 등 모든 숫자-슬롯 타입에 자동 적용됨
  - 그 외: option_sub_type 그대로 사용
"""
import asyncio
import gc
import json
import os
import re
import sys
from typing import Optional, Set

import aiohttp

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api_client import get_headers

MAX_CONCURRENT_TASKS = 3

# 그래프 불가 서브타입 (텍스트 전용 — 숫자 수치 없음)
EXCLUDED_SUBTYPES = {
    "종족명",
    "전용 파우치 (아래쪽)",
    "전용 파우치 (오른쪽)",
}


def extract_stat_name(option_value: str) -> Optional[str]:
    """
    "마법 공격력 20 레벨" → "마법 공격력"
    숫자 이전의 텍스트를 스탯명으로 반환합니다.
    """
    match = re.search(r'\d+', option_value)
    if match and match.start() > 0:
        return option_value[:match.start()].strip() or None
    return None


def load_categories() -> list:
    path = os.path.join(os.path.dirname(__file__), "category.txt")
    try:
        with open(path, "r", encoding="utf-8") as f:
            cats = [l.strip() for l in f if l.strip() and not l.startswith('#')]
        print(f"카테고리 {len(cats)}개 로드 완료.")
        return cats
    except FileNotFoundError:
        print(f"[Error] 카테고리 파일을 찾을 수 없습니다: {path}")
        return []


async def worker_collect_options(
    session: aiohttp.ClientSession,
    category: str,
    semaphore: asyncio.Semaphore,
) -> Set[str]:
    async with semaphore:
        print(f"카테고리 '{category}' 수집 시작...")
        opts: Set[str] = set()
        item_count = 0
        page = 0

        while True:
            page += 1
            params = {"first_category": category, "page": page}

            try:
                async with session.get(
                    "https://open.api.nexon.com/mabinogi/v1/auction/list",
                    headers=get_headers(),
                    params=params,
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        items = data.get("auction_item", [])
                        if not items:
                            break

                        item_count += len(items)

                        for item in items:
                            for opt in (item.get("item_option") or []):
                                opt_type = opt.get("option_type")
                                opt_sub  = opt.get("option_sub_type")

                                if not opt_type:
                                    continue
                                if opt_sub and opt_sub in EXCLUDED_SUBTYPES:
                                    continue

                                # sub_type이 순수 숫자(슬롯 번호)이면
                                # option_value에서 스탯명 추출
                                if opt_sub and str(opt_sub).strip().isdigit():
                                    stat = extract_stat_name(str(opt.get("option_value", "")))
                                    if stat:
                                        opts.add(f"{opt_type}|{stat}")
                                    continue

                                if opt_sub and str(opt_sub).lower() != "none":
                                    opts.add(f"{opt_type}|{opt_sub}")
                                else:
                                    opts.add(opt_type)

                        if len(items) < 500:
                            break

                        del items, data
                        await asyncio.sleep(0.1)

                    elif resp.status == 429:
                        print(f"  속도 제한 - '{category}' p{page}, 5초 대기")
                        await asyncio.sleep(5)
                        page -= 1
                    else:
                        print(f"  오류 - '{category}' p{page}: {resp.status}")
                        break

            except Exception as e:
                print(f"  예외 - '{category}' p{page}: {e}")
                break

        print(f"'{category}': 아이템 {item_count}개, 옵션 {len(opts)}개")
        gc.collect()
        return opts


async def collect_all_options():
    final: Set[str] = set()
    cats = load_categories()
    if not cats:
        return

    sem = asyncio.Semaphore(MAX_CONCURRENT_TASKS)
    conn = aiohttp.TCPConnector(limit=MAX_CONCURRENT_TASKS, force_close=True)

    async with aiohttp.ClientSession(connector=conn) as session:
        results = await asyncio.gather(*[
            worker_collect_options(session, c, sem) for c in cats
        ])
        for r in results:
            final.update(r)

    print(f"\n전체 고유 옵션: {len(final)}개")
    out = os.path.join(os.path.dirname(__file__), "item_options.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(sorted(final), f, ensure_ascii=False, indent=2)
    print(f"저장 완료: {out}")


if __name__ == "__main__":
    asyncio.run(collect_all_options())
