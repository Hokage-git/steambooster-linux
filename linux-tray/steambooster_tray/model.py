from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import StrEnum


class HealthState(StrEnum):
    HEALTHY = "healthy"
    RECOVERING = "recovering"
    FAILED = "failed"
    STEAM_UNAVAILABLE = "steam_unavailable"


@dataclass(frozen=True)
class HealthSnapshot:
    state: HealthState
    detail: str
    steam_available: bool
    launcher_active: bool
    button_present: bool


def classify_health(
    steam_available: bool,
    launcher_active: bool,
    button_present: bool,
) -> HealthSnapshot:
    if not steam_available:
        return HealthSnapshot(
            HealthState.STEAM_UNAVAILABLE,
            "Steam недоступен",
            False,
            launcher_active,
            False,
        )
    if not launcher_active:
        return HealthSnapshot(
            HealthState.FAILED,
            "Лаунчер Booster не запущен",
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
            False,
        )
    return HealthSnapshot(
        HealthState.HEALTHY,
        "Booster работает",
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
    ) -> None:
        self.bad_samples_required = bad_samples_required
        self.max_restarts = max_restarts
        self.window_seconds = window_seconds
        self._bad_samples = 0
        self._restarts: deque[float] = deque()

    def observe(self, healthy: bool, now: float) -> bool:
        if healthy:
            self._bad_samples = 0
            return False

        self._bad_samples += 1
        if self._bad_samples < self.bad_samples_required:
            return False

        self._bad_samples = 0
        while self._restarts and now - self._restarts[0] >= self.window_seconds:
            self._restarts.popleft()
        if len(self._restarts) >= self.max_restarts:
            return False

        self._restarts.append(now)
        return True

