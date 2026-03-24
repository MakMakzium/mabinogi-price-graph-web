"""
무리아스 유물 옵션 목록 수집 스크립트.

Nexon 경매장 API에서 '무리아스의 유물' 아이템을 페이지 순회하며
option_type == '무리아스 유물'인 항목의 option_value 앞부분에서 스탯명을 추출합니다.

수집 완료 후:
  - 발견된 옵션 목록 출력
  - item_options.json에 "무리아스 유물|<스탯명>" 형태로 병합 저장
"""
import asyncio
import json
import os
import re
import sys

import aiohttp
from dotenv import load_dotenv

# backend/.env 자동 로드
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api_client import get_headers

OPTION_TYPE = "무리아스 유물"
ITEM_NAME   = "무리아스의 유물"
CATEGORY    = "유물"
API_URL     = "https://open.api.nexon.com/mabinogi/v1/auction/list"


def extract_stat_name(option_value: str) -> str | None:
    """'파이어 리프 어택 5 레벨' → '파이어 리프 어택'"""
    m = re.search(r'\d+', option_value)
    if m and m.start() > 0:
        raw = option_value[:m.start()]
        name = re.sub(r'[\s(（\[「『\-_]+$', '', raw).strip()
        return name or None
    return None


async def collect(session: aiohttp.ClientSession) -> set[str]:
    stats: set[str] = set()
    page = 0

    while True:
        page += 1
        params = {
            "first_category": CATEGORY,
            "item_name": ITEM_NAME,
            "page": page,
        }

        try:
            async with session.get(API_URL, headers=get_headers(), params=params) as resp:
                if resp.status == 429:
                    print(f"  속도 제한 p{page}, 5초 대기...")
                    await asyncio.sleep(5)
                    page -= 1
                    continue

                if resp.status != 200:
                    print(f"  오류 p{page}: HTTP {resp.status}")
                    break

                data = await resp.json()
                items = data.get("auction_item", [])

                if not items:
                    print(f"  p{page}: 결과 없음, 수집 종료")
                    break

                for item in items:
                    for opt in (item.get("item_option") or []):
                        if opt.get("option_type") != OPTION_TYPE:
                            continue

                        sub   = opt.get("option_sub_type") or ""
                        value = str(opt.get("option_value", ""))

                        # sub_type이 숫자(슬롯 번호)이거나 없으면 value에서 추출
                        if not sub or sub.strip().isdigit():
                            stat = extract_stat_name(value)
                            if stat:
                                stats.add(stat)
                        else:
                            stats.add(sub)

                print(f"  p{page}: 아이템 {len(items)}개, 누적 스탯 {len(stats)}개")

                if len(items) < 500:
                    break

                await asyncio.sleep(0.2)

        except Exception as e:
            print(f"  예외 p{page}: {e}")
            break

    return stats


def merge_into_item_options(new_stats: set[str]) -> None:
    json_path = os.path.join(os.path.dirname(__file__), "item_options.json")

    with open(json_path, "r", encoding="utf-8") as f:
        existing: list[str] = json.load(f)

    existing_set = set(existing)

    # 기존 "무리아스 유물" 단독 항목 제거, 새 서브타입 항목 추가
    existing_set.discard(OPTION_TYPE)
    for stat in new_stats:
        existing_set.add(f"{OPTION_TYPE}|{stat}")

    merged = sorted(existing_set)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print(f"\nitem_options.json 업데이트 완료: {json_path}")


async def main():
    print(f"'{ITEM_NAME}' 옵션 수집 시작 (category={CATEGORY})\n")

    async with aiohttp.ClientSession() as session:
        stats = await collect(session)

    if not stats:
        print("수집된 옵션이 없습니다. API 키나 카테고리를 확인하세요.")
        return

    print(f"\n수집된 스탯 ({len(stats)}개):")
    for s in sorted(stats):
        print(f"  {OPTION_TYPE}|{s}")

    answer = input("\nitem_options.json에 병합할까요? [y/N] ").strip().lower()
    if answer == "y":
        merge_into_item_options(stats)
    else:
        print("병합 취소.")


if __name__ == "__main__":
    asyncio.run(main())
