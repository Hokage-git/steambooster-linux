from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import StrEnum
import time


class HealthState(StrEnum):
    HEALTHY = "healthy"
    RECOVERING = "recovering"
    FAILED = "failed"
    STEAM_UNAVAILABLE = "steam_unavailable"


class RecoveryDecision(StrEnum):
    NONE = "none"
    RESTART = "restart"
    EXHAUSTED = "exhausted"


@dataclass(frozen=True)
class HealthSnapshot:
    state: HealthState
    detail: str
    steam_available: bool
    cdp_available: bool
    launcher_active: bool
    button_present: bool
    generation: str | None = None


def classify_health(
    steam_available: bool,
    launcher_active: bool,
    button_present: bool,
    cdp_available: bool | None = None,
    generation: str | None = None,
) -> HealthSnapshot:
    cdp_available = steam_available if cdp_available is None else cdp_available
    if not steam_available:
        return HealthSnapshot(
            state=HealthState.STEAM_UNAVAILABLE,
            detail="Steam недоступен",
            steam_available=False,
            cdp_available=False,
            launcher_active=launcher_active,
            button_present=False,
            generation=generation,
        )
    if not cdp_available:
        return HealthSnapshot(
            state=HealthState.FAILED,
            detail="CDP недоступен — запустите Steam через SteamBooster",
            steam_available=True,
            cdp_available=False,
            launcher_active=launcher_active,
            button_present=False,
            generation=generation,
        )
    if not launcher_active:
        return HealthSnapshot(
            state=HealthState.FAILED,
            detail="Лаунчер Booster не запущен",
            steam_available=True,
            cdp_available=True,
            launcher_active=False,
            button_present=button_present,
            generation=generation,
        )
    if not button_present:
        return HealthSnapshot(
            state=HealthState.RECOVERING,
            detail="Кнопка «Пополнить» не найдена",
            steam_available=True,
            cdp_available=True,
            launcher_active=True,
            button_present=False,
            generation=generation,
        )
    return HealthSnapshot(
        state=HealthState.HEALTHY,
        detail="Booster работает",
        steam_available=True,
        cdp_available=True,
        launcher_active=True,
        button_present=True,
        generation=generation,
    )


class RecoveryPolicy:
    def __init__(
        self,
        bad_samples_required: int = 3,
        max_restarts: int = 3,
        window_seconds: float = 600,
        grace_seconds: float = 30,
        started_at: float | None = None,
        max_backoff_seconds: float = 120,
    ) -> None:
        self.bad_samples_required = bad_samples_required
        self.max_restarts = max_restarts
        self.window_seconds = window_seconds
        self.grace_seconds = grace_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self._grace_until = (time.monotonic() if started_at is None else started_at) + grace_seconds
        self._bad_samples = 0
        self._restarts: deque[float] = deque()
        self._exhausted = False

    def reset(self, now: float) -> None:
        self._bad_samples = 0
        self._restarts.clear()
        self._exhausted = False
        self._grace_until = now

    def observe(self, healthy: bool, now: float) -> RecoveryDecision:
        if healthy:
            self._bad_samples = 0
            self._exhausted = False
            return RecoveryDecision.NONE

        if now < self._grace_until:
            self._bad_samples = 0
            return RecoveryDecision.NONE

        while self._restarts and now - self._restarts[0] >= self.window_seconds:
            self._restarts.popleft()
        if self._exhausted and len(self._restarts) >= self.max_restarts:
            return RecoveryDecision.EXHAUSTED
        self._exhausted = False

        self._bad_samples += 1
        if self._bad_samples < self.bad_samples_required:
            return RecoveryDecision.NONE

        self._bad_samples = 0
        if len(self._restarts) >= self.max_restarts:
            self._exhausted = True
            return RecoveryDecision.EXHAUSTED

        self._restarts.append(now)
        backoff = min(
            self.grace_seconds * (2 ** len(self._restarts)),
            self.max_backoff_seconds,
        )
        self._grace_until = now + backoff
        return RecoveryDecision.RESTART
