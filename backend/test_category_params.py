"""
auction/list 파라미터 검증 테스트.

확인 항목:
  1. auction_item_category=유물 → 올바른 아이템이 오는지
  2. auction_item_category=유물 + item_name=무리아스의 유물 → item_name 파라미터가 필터로 동작하는지
  3. keyword-search?keyword=무리아스의 유물 → 위와 결과 비교

실행: python test_category_params.py
"""
import asyncio
import os
import aiohttp
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

API_KEY = os.getenv("NEXON_API_KEYS") or os.getenv("NEXON_API_KEY") or ""
HEADERS = {"x-nxopen-api-key": API_KEY.split(",")[0].strip()}
BASE    = "https://open.api.nexon.com/mabinogi/v1/auction"


async def run(session: aiohttp.ClientSession, label: str, url: str, params: dict, rounds: int = 3):
    print(f"\n=== {label} ===")
    items_all, names, cursor_param = [], {}, None
    for r in range(rounds):
        p = dict(params)
        if cursor_param:
            p["cursor"] = cursor_param
        async with session.get(url, headers=HEADERS, params=p) as resp:
            data = await resp.json()
        items = data.get("auction_item", [])
        cursor_param = data.get("next_cursor")
        first = items[0].get("item_name", "?") if items else "-"
        print(f"  round={r}  items={len(items)}  첫아이템='{first}'  next_cursor={'있음' if cursor_param else '없음'}")
        for it in items:
            n = it.get("item_name", "")
            names[n] = names.get(n, 0) + 1
        items_all.extend(items)
        if not cursor_param or not items:
            break
        await asyncio.sleep(0.1)

    top = sorted(names.items(), key=lambda x: -x[1])[:5]
    print(f"  → 총 매물: {len(items_all)}  고유 아이템명 수: {len(names)}")
    print(f"  상위 아이템명: {top}")
    return items_all, names


async def main():
    if not API_KEY:
        print("❌ NEXON_API_KEY 환경변수가 없습니다.")
        return

    async with aiohttp.ClientSession() as session:
        # 1. auction_item_category=유물 만
        await run(session,
                  "auction_item_category=유물",
                  f"{BASE}/list",
                  {"auction_item_category": "유물"})

        # 2. auction_item_category=유물 + item_name=무리아스의 유물
        await run(session,
                  "auction_item_category=유물 + item_name=무리아스의 유물",
                  f"{BASE}/list",
                  {"auction_item_category": "유물", "item_name": "무리아스의 유물"})

        # 3. keyword-search?keyword=무리아스의 유물
        await run(session,
                  "keyword-search?keyword=무리아스의 유물",
                  f"{BASE}/keyword-search",
                  {"keyword": "무리아스의 유물"})


asyncio.run(main())
