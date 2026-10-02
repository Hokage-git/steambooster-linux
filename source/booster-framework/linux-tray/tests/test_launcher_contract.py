import unittest
from pathlib import Path


class LauncherContractTests(unittest.TestCase):
    def setUp(self):
        self.bin_dir = Path(__file__).resolve().parent.parent / "bin"

    def test_launcher_only_cannot_start_steam(self):
        script = (self.bin_dir / "steambooster-launcher-only").read_text()
        self.assertNotIn("/usr/bin/steam", script)
        self.assertNotIn("STEAM_BIN", script)
        self.assertIn("dist/index.js", script)

    def test_desktop_wrapper_delegates_node_ownership_to_systemd(self):
        script = (self.bin_dir / "steambooster-steam").read_text()
        self.assertNotIn("NODE_BIN", script)
        self.assertNotIn("dist/index.js", script)
        self.assertIn("steambooster-launcher.service", script)


if __name__ == "__main__":
    unittest.main()
