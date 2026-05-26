"""
분양 메달 카테고리 API vs 키워드 검색 API 비교 테스트.

실행: python test_category_vs_keyword.py
(NEXON_API_KEY 환경변수 필요)
"""
import asyncio
import os
import aiohttp
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

API_KEY  = os.getenv("NEXON_API_KEYS") or os.getenv("NEXON_API_KEY") or ""
HEADERS  = {"x-nxopen-api-key": API_KEY.split(",")[0].strip()}
BASE     = "https://open.api.nexon.com/mabinogi/v1/auction"

CATEGORY  = "분양 메달"
KEYWORD   = "동물 캐릭터 분양 메달"
OPT_TYPE  = "펫 정보"
OPT_SUB   = "종족명"


def extract_race(item: dict) -> str | None:
    for opt in (item.get("item_option") or []):
        if opt.get("option_type") == OPT_TYPE and opt.get("option_sub_type") == OPT_SUB:
            return str(opt.get("option_value") or "").strip() or None
    return None


# ── 카테고리 API (page 방식) ──────────────────────────────────────────────────

async def fetch_category_page(session: aiohttp.ClientSession, page: int) -> dict:
    async with session.get(
        f"{BASE}/list",
        headers=HEADERS,
        params={"first_category": CATEGORY, "page": page},
    ) as r:
        return await r.json()


async def run_category_page(session: aiohttp.ClientSession):
    print(f"\n=== auction/list?first_category={CATEGORY} (page 방식) ===")
    items_all, races, page = [], set(), 1
    seen_ids: set = set()
    while True:
        data    = await fetch_category_page(session, page)
        items   = data.get("auction_item", [])
        cursor  = data.get("next_cursor")
        # 중복 감지: auction_id 또는 첫 아이템 이름으로 확인
        first_name = items[0].get("item_name", "?") if items else "-"
        new_ids = {it.get("item_name","") + str(it.get("auction_price_per_unit","")) for it in items}
        dup_count = len(new_ids & seen_ids)
        seen_ids |= new_ids
        print(f"  page={page}  items={len(items)}  중복={dup_count}  첫아이템='{first_name}'  next_cursor={'있음' if cursor else '없음'}")
        items_all.extend(items)
        for it in items:
            r = extract_race(it)
            if r:
                races.add(r)
        if len(items) < 500 or page >= 5:
            break
        page += 1
    print(f"  → 총 매물: {len(items_all)}  고유 종족명: {len(races)}")
    return items_all, races


# ── 카테고리 API (auction_item_category 방식) ─────────────────────────────────

async def run_auction_item_category(session: aiohttp.ClientSession):
    print(f"\n=== auction/list?auction_item_category={CATEGORY} (cursor 방식) ===")
    items_all, races, rounds = [], set(), 0
    cursor = None
    while rounds < 5:
        params: dict = {"auction_item_category": CATEGORY}
        if cursor:
            params["cursor"] = cursor
        async with session.get(f"{BASE}/list", headers=HEADERS, params=params) as r:
            data = await r.json()
        items  = data.get("auction_item", [])
        cursor = data.get("next_cursor")
        first_name = items[0].get("item_name", "?") if items else "-"
        print(f"  round={rounds}  items={len(items)}  첫아이템='{first_name}'  next_cursor={'있음' if cursor else '없음'}")
        items_all.extend(items)
        for it in items:
            r = extract_race(it)
            if r:
                races.add(r)
        if not cursor or not items:
            break
        rounds += 1
        await asyncio.sleep(0.1)
    print(f"  → 총 매물: {len(items_all)}  고유 종족명: {len(races)}")
    return items_all, races


# ── 키워드 검색 API (cursor 방식) ─────────────────────────────────────────────

async def run_keyword(session: aiohttp.ClientSession):
    print(f"\n=== auction/keyword-search?keyword={KEYWORD} ===")
    items_all, races, cursor = [], set(), None
    while True:
        params: dict = {"keyword": KEYWORD}
        if cursor:
            params["cursor"] = cursor
        async with session.get(f"{BASE}/keyword-search", headers=HEADERS, params=params) as r:
            data = await r.json()
        items  = data.get("auction_item", [])
        cursor = data.get("next_cursor")
        print(f"  items={len(items)}  next_cursor={'있음' if cursor else '없음'}")
        items_all.extend(items)
        for it in items:
            r = extract_race(it)
            if r:
                races.add(r)
        if not cursor or not items:
            break
        await asyncio.sleep(0.1)
    print(f"  → 총 매물: {len(items_all)}  고유 종족명: {len(races)}")
    return items_all, races


async def main():
    if not API_KEY:
        print("❌ NEXON_API_KEY 환경변수가 없습니다.")
        return
    async with aiohttp.ClientSession() as session:
        cat_page_items, cat_page_races = await run_category_page(session)
        aic_items,      aic_races      = await run_auction_item_category(session)
        kw_items,       kw_races       = await run_keyword(session)

    print("\n=== 비교 ===")
    print(f"first_category        : 매물 {len(cat_page_items):>5}개  고유 종족명 {len(cat_page_races):>3}개")
    print(f"auction_item_category : 매물 {len(aic_items):>5}개  고유 종족명 {len(aic_races):>3}개")
    print(f"키워드 검색           : 매물 {len(kw_items):>5}개  고유 종족명 {len(kw_races):>3}개")
    only_kw = kw_races - aic_races
    if only_kw:
        print(f"\n키워드에만 있는 종족명 ({len(only_kw)}개): {sorted(only_kw)}")


asyncio.run(main())
