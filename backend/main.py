import json
import os
from typing import Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_logic import get_price_graph_data

app = FastAPI()

# CORS 설정
# ALLOWED_ORIGINS 환경변수에 콤마로 구분된 주소를 넣으면 해당 주소만 허용
# 환경변수가 없으면 개발 편의를 위해 전체 허용
_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 옵션 목록 캐시 (원본 flat 리스트)
_options_cache: List[str] = []


@app.on_event("startup")
def load_options():
    """서버 시작 시 item_options.json 파일을 읽어 캐시에 저장합니다."""
    global _options_cache
    options_path = os.path.join(os.path.dirname(__file__), "scraper", "item_options.json")
    try:
        with open(options_path, "r", encoding="utf-8") as f:
            _options_cache = json.load(f)
        print(f"✅ {len(_options_cache)}개의 아이템 옵션을 성공적으로 로드했습니다.", flush=True)
    except FileNotFoundError:
        print("⚠️ 'item_options.json' 파일을 찾을 수 없습니다. 옵션 수집 스크립트를 먼저 실행해주세요.", flush=True)
    except Exception as e:
        print(f"❌ 아이템 옵션 로드 중 오류 발생: {e}", flush=True)


@app.get("/")
def read_root():
    return {"message": "마비노기 옵션별 가격 그래프 API"}


@app.get("/options")
def get_options() -> Dict[str, List[str]]:
    """
    옵션을 타입별로 그룹핑하여 반환합니다.
    색상 등 그래프로 의미 없는 옵션은 제외합니다.
    예: {"세공 옵션": ["마법 공격력", "최대 공격력", ...], "에르그": ["A", "B", "S"], ...}
    """
    grouped: Dict[str, List[str]] = {}
    for opt in _options_cache:
        if '|' in opt:
            opt_type, sub_type = opt.split('|', 1)
            grouped.setdefault(opt_type, []).append(sub_type)
        else:
            grouped.setdefault(opt, [])
    return grouped


@app.get("/graph-data")
async def get_graph_data_endpoint(
    item_name: str,
    option_id: str,
    and_options: Optional[str] = None,
):
    """
    특정 아이템과 옵션에 대한 가격 그래프 데이터를 반환합니다.
    - item_name: 아이템 이름 (예: "나이트브링어 인퀴지터")
    - option_id: 그래프 기준 옵션 (예: "세공|마법 공격력")
    - and_options: AND 조건 옵션 목록, 콤마 구분 (예: "세공|최대 공격력,에르그")
    """
    # 구분자로 세미콜론(;) 사용 — RGB 값(0,0,0)에 콤마가 포함되므로
    and_list = [o.strip() for o in and_options.split(';') if o.strip()] if and_options else []
    data = await get_price_graph_data(item_name, option_id, and_list)
    return data
