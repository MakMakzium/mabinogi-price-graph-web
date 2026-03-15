"""
봇의 modules/api.py 구조를 참고한 API 키 관리 모듈.
NEXON_API_KEYS (복수, 콤마 구분) 또는 NEXON_API_KEY (단수) 환경변수를 지원합니다.
"""
import itertools
import os
from typing import List


def _load_api_keys() -> List[str]:
    """환경 변수에서 Nexon API 키를 로드합니다. 복수형을 먼저 확인합니다."""
    keys_str = os.getenv("NEXON_API_KEYS") or os.getenv("NEXON_API_KEY")
    if not keys_str:
        raise ValueError("NEXON_API_KEYS 또는 NEXON_API_KEY 환경 변수가 설정되지 않았습니다.")
    keys = [k.strip() for k in keys_str.split(',') if k.strip()]
    if not keys:
        raise ValueError("유효한 API 키가 없습니다.")
    print(f"✅ {len(keys)}개의 Nexon API 키를 로드했습니다.", flush=True)
    return keys


class APIKeyRotator:
    """라운드-로빈 방식으로 API 키를 순환합니다."""

    def __init__(self):
        self.keys = _load_api_keys()
        self._cycle = itertools.cycle(self.keys)

    def get_key(self) -> str:
        return next(self._cycle)


_rotator = APIKeyRotator()


def get_api_key() -> str:
    """다음 API 키를 반환합니다."""
    return _rotator.get_key()


def get_headers() -> dict:
    """Nexon API 요청에 필요한 헤더를 반환합니다."""
    return {"x-nxopen-api-key": get_api_key()}
