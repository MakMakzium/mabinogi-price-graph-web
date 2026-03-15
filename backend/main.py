from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
import os
from api_logic import get_price_graph_data

app = FastAPI()

# CORS 설정
# ALLOWED_ORIGINS 환경변수에 콤마로 구분된 주소를 넣으면 해당 주소만 허용
# 예: "https://my-app.netlify.app,http://localhost:3000"
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

# 옵션 목록 캐시
_options_cache = []

@app.on_event("startup")
def load_options():
    """서버 시작 시 item_options.json 파일을 읽어 캐시에 저장합니다."""
    global _options_cache
    options_path = os.path.join(os.path.dirname(__file__), "scraper", "item_options.json")
    try:
        with open(options_path, "r", encoding="utf-8") as f:
            _options_cache = json.load(f)
        print(f"✅ {len(_options_cache)}개의 아이템 옵션을 성공적으로 로드했습니다.")
    except FileNotFoundError:
        print("⚠️ 'item_options.json' 파일을 찾을 수 없습니다. 옵션 수집 스크립트를 먼저 실행해주세요.")
    except Exception as e:
        print(f"❌ 아이템 옵션 로드 중 오류 발생: {e}")

@app.get("/")
def read_root():
    return {"message": "마비노기 옵션별 가격 그래프 API"}

@app.get("/options")
def get_options():
    """수집된 모든 고유 아이템 옵션 목록을 반환합니다."""
    return _options_cache

@app.get("/graph-data")
async def get_graph_data_endpoint(item_name: str, option_id: str):
    """
    특정 아이템과 옵션에 대한 가격 그래프 데이터를 반환합니다.
    - item_name: 아이템 이름 (예: "나이트브링어 인퀴지터")
    - option_id: 옵션 식별자 (예: "마법 공격력" 또는 "세공|최대대미지레벨")
    """
    data = await get_price_graph_data(item_name, option_id)
    return data
