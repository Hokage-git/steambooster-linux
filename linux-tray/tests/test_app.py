import os
import unittest
from pathlib import Path
from unittest.mock import patch

from steambooster_tray.app import ActionGate, TrayPaths, is_recoverable, runtime_lock_path
from steambooster_tray.model import HealthState, classify_health


class AppHelperTests(unittest.TestCase):
    def test_paths_keep_logs_in_workspace_docs(self):
        root = Path("/docs/SteamBooster/source/booster-framework/linux-tray")
        paths = TrayPaths.from_tray_root(root)
        self.assertEqual(paths.probe, root / "probe.mjs")
        self.assertEqual(
            paths.log,
            Path("/docs/SteamBooster/docs/artifacts/logs/launcher.log"),
        )

    def test_runtime_lock_uses_xdg_runtime_directory(self):
        with patch.dict(os.environ, {"XDG_RUNTIME_DIR": "/run/user/1234"}):
            self.assertEqual(
                runtime_lock_path(),
                Path("/run/user/1234/steambooster/tray.lock"),
            )

    def test_missing_button_is_recoverable(self):
        snapshot = classify_health(True, True, False)
        self.assertTrue(is_recoverable(snapshot))

    def test_absent_steam_is_never_auto_recoverable(self):
        snapshot = classify_health(False, False, False)
        self.assertEqual(snapshot.state, HealthState.STEAM_UNAVAILABLE)
        self.assertFalse(is_recoverable(snapshot))

    def test_running_steam_without_cdp_is_not_auto_recoverable(self):
        snapshot = classify_health(True, True, False, cdp_available=False)
        self.assertFalse(is_recoverable(snapshot))

    def test_action_gate_rejects_overlapping_actions(self):
        gate = ActionGate()
        self.assertTrue(gate.enter())
        self.assertFalse(gate.enter())
        gate.leave()
        self.assertTrue(gate.enter())


if __name__ == "__main__":
    unittest.main()
