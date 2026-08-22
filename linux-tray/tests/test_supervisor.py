import json
import unittest
from pathlib import Path

from steambooster_tray.model import HealthState
from steambooster_tray.supervisor import BoosterSupervisor, RunResult


class FakeRunner:
    def __init__(self, service_active=True, probe=None):
        self.service_active = service_active
        self.probe = probe or {
            "steam_available": True,
            "cdp_available": True,
            "main_available": True,
            "button_present": True,
        }
        self.calls = []

    def __call__(self, args, timeout):
        self.calls.append((tuple(args), timeout))
        if args[:4] == ["systemctl", "--user", "is-active", "--quiet"]:
            return RunResult(0 if self.service_active else 3, "", "")
        if args[:3] == ["systemctl", "--user", "restart"]:
            return RunResult(0, "", "")
        return RunResult(0, json.dumps(self.probe), "")


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.probe_path = Path("/project/probe.mjs")
        self.log_path = Path("/project/launcher.log")

    def make_supervisor(self, runner):
        return BoosterSupervisor(
            probe_path=self.probe_path,
            log_path=self.log_path,
            runner=runner,
        )

    def test_health_uses_service_and_live_probe(self):
        supervisor = self.make_supervisor(FakeRunner())
        self.assertEqual(supervisor.health().state, HealthState.HEALTHY)

    def test_inactive_launcher_is_failed_even_if_probe_has_button(self):
        supervisor = self.make_supervisor(FakeRunner(service_active=False))
        self.assertEqual(supervisor.health().state, HealthState.FAILED)

    def test_cdp_unavailable_is_reported_without_launcher_recovery(self):
        runner = FakeRunner(probe={
            "steam_available": True,
            "cdp_available": False,
            "main_available": False,
            "button_present": False,
        })
        snapshot = self.make_supervisor(runner).health()
        self.assertEqual(snapshot.state, HealthState.FAILED)
        self.assertFalse(snapshot.cdp_available)

    def test_malformed_probe_is_failed_without_throwing(self):
        runner = FakeRunner()
        runner.probe = None

        def malformed(args, timeout):
            if args[:4] == ["systemctl", "--user", "is-active", "--quiet"]:
                return RunResult(0, "", "")
            return RunResult(1, "not-json", "probe failed")

        supervisor = self.make_supervisor(malformed)
        self.assertEqual(supervisor.health().state, HealthState.FAILED)

    def test_restart_only_calls_booster_service(self):
        runner = FakeRunner()
        supervisor = self.make_supervisor(runner)
        supervisor.restart_launcher()
        command = runner.calls[-1][0]
        self.assertEqual(
            command,
            ("systemctl", "--user", "restart", "steambooster-launcher.service"),
        )
        self.assertNotIn("steam", " ".join(command).lower().replace("steambooster", ""))


if __name__ == "__main__":
    unittest.main()
