import os
from dotenv import load_dotenv

# .env 파일에서 환경 변수를 로드합니다.
load_dotenv()

NEXON_API_KEY = os.getenv("NEXON_API_KEY")

if not NEXON_API_KEY:
    raise ValueError("'.env' 파일에 NEXON_API_KEY가 설정되지 않았습니다.")
