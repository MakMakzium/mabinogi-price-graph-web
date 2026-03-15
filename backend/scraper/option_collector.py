import asyncio
import aiohttp
import json
import os
import sys
import gc
from typing import Set

# Add parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import NEXON_API_KEY

# --- Constants ---
# To avoid being blocked by the API (429 Too Many Requests)
# and to reduce the load, we limit the number of concurrent requests.
# To prevent memory exhaustion and BSODs (bad_pool_header), keep this number low.
MAX_CONCURRENT_TASKS = 3

def load_categories() -> list[str]:
    """Loads categories from category.txt in the scraper directory."""
    category_file_path = os.path.join(os.path.dirname(__file__), "category.txt")
    try:
        with open(category_file_path, "r", encoding="utf-8") as f:
            categories = [line.strip() for line in f if line.strip() and not line.startswith('#')]
        print(f"Loaded {len(categories)} categories from '{category_file_path}'.")
        return categories
    except FileNotFoundError:
        print(f"[Error] Category file '{category_file_path}' not found.")
        return []

async def worker_collect_options(session: aiohttp.ClientSession, category: str, semaphore: asyncio.Semaphore) -> Set[str]:
    """
    Worker that fetches items page by page for a category, extracts unique options,
    and discards the item data to keep memory usage low.
    """
    async with semaphore:
        print(f"Starting to collect options for category '{category}'...")
        category_options: Set[str] = set()
        item_count = 0
        current_page = 0

        while True:
            current_page += 1
            url = "https://open.api.nexon.com/mabinogi/v1/auction/list"
            params = {"first_category": category, "page": current_page}

            try:
                async with session.get(url, params=params) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        items_on_page = data.get("auction_item", [])
                        
                        if not items_on_page:
                            print(f"  - Category '{category}' has no more items.")
                            break

                        item_count += len(items_on_page)

                        for item in items_on_page:
                            item_options = item.get("item_option")
                            if not item_options:
                                continue

                            for option in item_options:
                                opt_type = option.get("option_type")
                                opt_sub_type = option.get("option_sub_type")

                                if not opt_type:
                                    continue

                                if opt_sub_type and str(opt_sub_type).lower() != 'none':
                                    unique_key = f"{opt_type}|{opt_sub_type}"
                                else:
                                    unique_key = opt_type
                                category_options.add(unique_key)

                        # The API returns up to 500 items per page.
                        if len(items_on_page) < 500:
                            print(f"  - Finished fetching all items for category '{category}'.")
                            break
                        
                        # Explicitly clear variables and sleep to relieve network and memory pressure
                        del items_on_page
                        del data
                        await asyncio.sleep(0.1)
                    
                    elif resp.status == 429:
                        print(f"  Rate limit exceeded for category '{category}', page {current_page}. Retrying...")
                        await asyncio.sleep(5)
                        current_page -= 1  # Retry the same page
                        continue
                    
                    else:
                        print(f"  - Error fetching category '{category}', page {current_page} - Status: {resp.status}")
                        break
            
            except Exception as e:
                print(f"  - Exception while fetching category '{category}', page {current_page}: {e}")
                break
        
        print(f"Category '{category}' collected {item_count} items and found {len(category_options)} unique options.")
        gc.collect() # Force garbage collection to ensure memory is freed
        return category_options

async def collect_all_options():
    """Collects all unique item options from all categories."""
    headers = {"x-nxopen-api-key": NEXON_API_KEY}
    final_unique_options: Set[str] = set()

    search_categories = load_categories()
    if not search_categories:
        print("No categories to search. Exiting.")
        return

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)

    # Use a TCPConnector to prevent too many open sockets and TIME_WAIT accumulation (avoids bad_pool_header BSOD)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT_TASKS, force_close=True)

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        tasks = [worker_collect_options(session, category, semaphore) for category in search_categories]
        results_from_categories = await asyncio.gather(*tasks)

        for category_options_set in results_from_categories:
            final_unique_options.update(category_options_set)

    print(f"\nFound a total of {len(final_unique_options)} unique options across all categories.")

    output_path = os.path.join(os.path.dirname(__file__), "item_options.json")
    with open(output_path, "w", encoding="utf-8") as f:
        sorted_options = sorted(list(final_unique_options))
        json.dump(sorted_options, f, ensure_ascii=False, indent=2)

    print(f"All unique options have been saved to '{output_path}'.")

if __name__ == "__main__":
    asyncio.run(collect_all_options())
