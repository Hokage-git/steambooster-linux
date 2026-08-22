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


def classify_health(
    steam_available: bool,
    launcher_active: bool,
    button_present: bool,
    cdp_available: bool | None = None,
) -> HealthSnapshot:
    cdp_available = steam_available if cdp_available is None else cdp_available
    if not steam_available:
        return HealthSnapshot(
            HealthState.STEAM_UNAVAILABLE,
            "Steam недоступен",
            False,
            False,
            launcher_active,
            False,
        )
    if not cdp_available:
        return HealthSnapshot(
            HealthState.FAILED,
            "CDP недоступен — запустите Steam через SteamBooster",
            True,
            False,
            launcher_active,
            False,
        )
    if not launcher_active:
        return HealthSnapshot(
            HealthState.FAILED,
            "Лаунчер Booster не запущен",
            True,
            True,
            False,
            button_present,
        )
    if not button_present:
        return HealthSnapshot(
            HealthState.RECOVERING,
            "Кнопка «Пополнить» не найдена",
            True,
            True,
            True,
            False,
        )
    return HealthSnapshot(
        HealthState.HEALTHY,
        "Booster работает",
        True,
        True,
        True,
        True,
    )


class RecoveryPolicy:
    def __init__(
        self,
        bad_samples_required: int = 3,
        max_restarts: int = 3,
        window_seconds: float = 600,
        grace_seconds: float = 30,
        started_at: float | None = None,
    ) -> None:
        self.bad_samples_required = bad_samples_required
        self.max_restarts = max_restarts
        self.window_seconds = window_seconds
        self.grace_seconds = grace_seconds
        self._grace_until = (time.monotonic() if started_at is None else started_at) + grace_seconds
        self._bad_samples = 0
        self._restarts: deque[float] = deque()

    def observe(self, healthy: bool, now: float) -> RecoveryDecision:
        if healthy:
            self._bad_samples = 0
            return RecoveryDecision.NONE

        if now < self._grace_until:
            self._bad_samples = 0
            return RecoveryDecision.NONE

        self._bad_samples += 1
        if self._bad_samples < self.bad_samples_required:
            return RecoveryDecision.NONE

        self._bad_samples = 0
        while self._restarts and now - self._restarts[0] >= self.window_seconds:
            self._restarts.popleft()
        if len(self._restarts) >= self.max_restarts:
            return RecoveryDecision.EXHAUSTED

        self._restarts.append(now)
        self._grace_until = now + self.grace_seconds
        return RecoveryDecision.RESTART
