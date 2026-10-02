from .model import HealthState


MENU_LABELS = {
    "restore": "Восстановить оверлей",
    "restart": "Перезапустить Booster",
    "open_steam": "Открыть Steam",
    "open_log": "Открыть лог",
    "quit": "Закрыть трей",
}


STATE_COLORS = {
    HealthState.HEALTHY: "#22c55e",
    HealthState.RECOVERING: "#eab308",
    HealthState.FAILED: "#ef4444",
    HealthState.STEAM_UNAVAILABLE: "#6b7280",
}


def state_color(state: HealthState) -> str:
    return STATE_COLORS[state]

