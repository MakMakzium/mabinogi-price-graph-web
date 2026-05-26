"""
봇의 modules/api.py 구조를 참고한 API 키 관리 모듈.
NEXON_API_KEYS (복수, 콤마 구분) 또는 NEXON_API_KEY (단수) 환경변수를 지원합니다.
"""
import asyncio
import itertools
import os
import time
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


# ── 전역 토큰 버킷 ─────────────────────────────────────────────────────────────
# Nexon API 한도: 키 1개당 2,000 req/s
# 봇(auction_bot)이 동일 키를 공유하며 키당 최대 500 req/s 사용.
# 웹에는 키당 1,000 req/s 할당 (나머지 500 req/s는 봇·네트워크 지연 버퍼).
# 키가 N개면 웹 전체 한도 = 1,000 × N req/s.

class _TokenBucket:
    """초당 rate개의 요청을 허용하는 토큰 버킷."""

    def __init__(self, rate: float):
        self._rate = rate
        self._tokens = float(rate)
        self._last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self._tokens = min(
                self._rate,
                self._tokens + (now - self._last) * self._rate,
            )
            self._last = now
            if self._tokens >= 1:
                self._tokens -= 1
                wait = 0.0
            else:
                wait = (1 - self._tokens) / self._rate
                self._tokens = 0
                self._last += wait  # 다음 refill 기준을 앞당김
        if wait > 0:
            await asyncio.sleep(wait)


nexon_limiter = _TokenBucket(1000 * len(_rotator.keys))
