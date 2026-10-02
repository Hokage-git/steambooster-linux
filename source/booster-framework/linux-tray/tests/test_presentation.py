import unittest

from steambooster_tray.model import HealthState
from steambooster_tray.presentation import MENU_LABELS, state_color


class PresentationTests(unittest.TestCase):
    def test_menu_has_manual_recovery_actions(self):
        self.assertEqual(MENU_LABELS["restore"], "Восстановить оверлей")
        self.assertEqual(MENU_LABELS["restart"], "Перезапустить Booster")
        self.assertEqual(MENU_LABELS["open_log"], "Открыть лог")

    def test_states_have_distinct_expected_colors(self):
        self.assertEqual(state_color(HealthState.HEALTHY), "#22c55e")
        self.assertEqual(state_color(HealthState.RECOVERING), "#eab308")
        self.assertEqual(state_color(HealthState.FAILED), "#ef4444")
        self.assertEqual(state_color(HealthState.STEAM_UNAVAILABLE), "#6b7280")


if __name__ == "__main__":
    unittest.main()
