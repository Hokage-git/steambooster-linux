import unittest

from steambooster_tray.model import (
    HealthState,
    RecoveryDecision,
    RecoveryPolicy,
    classify_health,
)


class HealthModelTests(unittest.TestCase):
    def test_healthy_requires_steam_launcher_and_button(self):
        snapshot = classify_health(True, True, True)
        self.assertEqual(snapshot.state, HealthState.HEALTHY)
        self.assertEqual(snapshot.detail, "Booster работает")

    def test_steam_unavailable_has_own_state(self):
        snapshot = classify_health(False, False, False)
        self.assertEqual(snapshot.state, HealthState.STEAM_UNAVAILABLE)

    def test_launcher_absent_is_failed(self):
        snapshot = classify_health(True, False, False)
        self.assertEqual(snapshot.state, HealthState.FAILED)
        self.assertIn("лаунчер", snapshot.detail.lower())

    def test_missing_button_is_recovering(self):
        snapshot = classify_health(True, True, False)
        self.assertEqual(snapshot.state, HealthState.RECOVERING)
        self.assertIn("Пополнить", snapshot.detail)

    def test_running_steam_without_cdp_is_not_launcher_recoverable(self):
        snapshot = classify_health(True, True, False, cdp_available=False)
        self.assertEqual(snapshot.state, HealthState.FAILED)
        self.assertFalse(snapshot.cdp_available)
        self.assertIn("CDP", snapshot.detail)


class RecoveryPolicyTests(unittest.TestCase):
    def test_requires_three_consecutive_bad_samples(self):
        policy = RecoveryPolicy(bad_samples_required=3, grace_seconds=0, started_at=0)
        self.assertEqual(policy.observe(False, now=1), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=2), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=3), RecoveryDecision.RESTART)

    def test_healthy_sample_resets_bad_sample_counter(self):
        policy = RecoveryPolicy(bad_samples_required=3, grace_seconds=0, started_at=0)
        policy.observe(False, now=1)
        policy.observe(False, now=2)
        self.assertEqual(policy.observe(True, now=3), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=4), RecoveryDecision.NONE)

    def test_startup_grace_ignores_bad_samples_for_thirty_seconds(self):
        policy = RecoveryPolicy(
            bad_samples_required=3,
            grace_seconds=30,
            started_at=0,
        )
        self.assertEqual(policy.observe(False, now=29), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=30), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=31), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=32), RecoveryDecision.RESTART)

    def test_limits_restarts_to_three_per_ten_minutes(self):
        policy = RecoveryPolicy(
            bad_samples_required=1,
            max_restarts=3,
            window_seconds=600,
            grace_seconds=0,
            started_at=0,
        )
        self.assertEqual(policy.observe(False, now=1), RecoveryDecision.RESTART)
        self.assertEqual(policy.observe(False, now=2), RecoveryDecision.RESTART)
        self.assertEqual(policy.observe(False, now=3), RecoveryDecision.RESTART)
        self.assertEqual(policy.observe(False, now=4), RecoveryDecision.EXHAUSTED)
        self.assertEqual(policy.observe(False, now=5), RecoveryDecision.EXHAUSTED)
        self.assertEqual(policy.observe(False, now=602), RecoveryDecision.RESTART)

    def test_manual_reset_clears_exhausted_budget(self):
        policy = RecoveryPolicy(
            bad_samples_required=1,
            max_restarts=1,
            grace_seconds=0,
            started_at=0,
        )
        self.assertEqual(policy.observe(False, now=1), RecoveryDecision.RESTART)
        self.assertEqual(policy.observe(False, now=2), RecoveryDecision.EXHAUSTED)
        policy.reset(now=3)
        self.assertEqual(policy.observe(False, now=3), RecoveryDecision.RESTART)

    def test_backoff_doubles_after_each_restart_up_to_bound(self):
        policy = RecoveryPolicy(
            bad_samples_required=1,
            max_restarts=5,
            grace_seconds=10,
            max_backoff_seconds=120,
            started_at=0,
        )
        self.assertEqual(policy.observe(False, now=10), RecoveryDecision.RESTART)
        self.assertEqual(policy.observe(False, now=29), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=30), RecoveryDecision.RESTART)
        self.assertEqual(policy.observe(False, now=69), RecoveryDecision.NONE)
        self.assertEqual(policy.observe(False, now=70), RecoveryDecision.RESTART)


if __name__ == "__main__":
    unittest.main()
