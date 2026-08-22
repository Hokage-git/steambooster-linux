import unittest

from steambooster_tray.model import (
    HealthState,
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


class RecoveryPolicyTests(unittest.TestCase):
    def test_requires_three_consecutive_bad_samples(self):
        policy = RecoveryPolicy(bad_samples_required=3)
        self.assertFalse(policy.observe(False, now=1))
        self.assertFalse(policy.observe(False, now=2))
        self.assertTrue(policy.observe(False, now=3))

    def test_healthy_sample_resets_bad_sample_counter(self):
        policy = RecoveryPolicy(bad_samples_required=3)
        policy.observe(False, now=1)
        policy.observe(False, now=2)
        self.assertFalse(policy.observe(True, now=3))
        self.assertFalse(policy.observe(False, now=4))

    def test_limits_restarts_to_three_per_ten_minutes(self):
        policy = RecoveryPolicy(
            bad_samples_required=1,
            max_restarts=3,
            window_seconds=600,
        )
        self.assertTrue(policy.observe(False, now=1))
        self.assertTrue(policy.observe(False, now=2))
        self.assertTrue(policy.observe(False, now=3))
        self.assertFalse(policy.observe(False, now=4))
        self.assertTrue(policy.observe(False, now=602))


if __name__ == "__main__":
    unittest.main()
