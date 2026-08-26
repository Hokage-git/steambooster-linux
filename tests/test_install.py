import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]


class PortableInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.home = root / "home"
        self.dist = root / "SteamBooster-Linux-x86_64"
        self._make_distribution(self.dist)
        self.env = {
            **os.environ,
            "HOME": str(self.home),
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "XDG_DATA_HOME": str(self.home / ".local" / "share"),
            "SB_SKIP_DEPENDENCY_CHECK": "1",
            "SB_SKIP_INTEGRATION": "1",
        }

    def tearDown(self):
        self.temp.cleanup()

    def _make_distribution(self, root: Path) -> None:
        for relative in (
            "source/booster-framework/out/booster-framework.js",
            "source/booster-framework/linux-launcher/dist/index.js",
            "source/booster-framework/linux-launcher/dist/handlers/config.js",
            "source/booster-framework/linux-launcher/dist/handlers/index.js",
            "source/booster-framework/linux-launcher/package.json",
            "source/booster-framework/linux-tray/run-tray.py",
            "source/booster-framework/linux-tray/probe.mjs",
            "source/booster-framework/linux-tray/steambooster_tray/__init__.py",
            "source/booster-framework/linux-tray/steambooster_tray/app.py",
            "source/booster-framework/linux-tray/steambooster_tray/model.py",
            "source/booster-framework/linux-tray/steambooster_tray/presentation.py",
            "source/booster-framework/linux-tray/steambooster_tray/supervisor.py",
            "source/steambooster-plugins/packages/booster-checkout/out/booster-checkout.js",
            "source/steambooster-plugins/packages/booster-checkout/out/booster-checkout.meta.json",
            "source/steambooster-plugins/packages/booster-addfunds/out/booster-addfunds.js",
            "source/steambooster-plugins/packages/booster-addfunds/out/booster-addfunds.meta.json",
        ):
            path = root / "payload" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture\n", encoding="utf-8")
        for name in ("install.sh", "uninstall.sh"):
            source = REPO / name
            destination = root / name
            if source.exists():
                destination.write_bytes(source.read_bytes())
                destination.chmod(0o755)
        scripts = root / "scripts"
        scripts.mkdir(parents=True, exist_ok=True)
        renderer = REPO / "scripts" / "render_install.py"
        if renderer.exists():
            (scripts / "render_install.py").write_bytes(renderer.read_bytes())

    def run_script(self, name: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(self.dist / name)],
            env=self.env,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_install_copies_payload_and_renders_user_paths(self):
        result = self.run_script("install.sh")
        self.assertEqual(result.returncode, 0, result.stderr)

        prefix = self.home / ".local" / "share" / "steambooster-linux"
        self.assertTrue((prefix / "source/booster-framework/linux-launcher/dist/index.js").is_file())
        launcher = self.home / ".local" / "bin" / "steambooster-launcher-only"
        self.assertTrue(launcher.stat().st_mode & 0o100)
        launcher_text = launcher.read_text(encoding="utf-8")
        self.assertIn(str(prefix / "source"), launcher_text)
        self.assertNotIn(str(Path.home()), launcher_text)

        desktop = (self.home / ".local/share/applications/steambooster.desktop").read_text(encoding="utf-8")
        self.assertIn("Categories=Game;", desktop)
        self.assertIn("x-scheme-handler/steam", desktop)
        service = (self.home / ".config/systemd/user/steambooster-launcher.service").read_text(encoding="utf-8")
        self.assertIn(str(launcher), service)
        self.assertIn("KillMode=process", service)

    def test_install_is_independent_of_extraction_directory(self):
        result = self.run_script("install.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        generated = [
            self.home / ".local/bin/steambooster-steam",
            self.home / ".local/bin/steambooster-launcher-only",
            self.home / ".config/systemd/user/steambooster-launcher.service",
            self.home / ".config/autostart/steambooster-tray.desktop",
            self.home / ".local/share/applications/steambooster.desktop",
        ]
        for path in generated:
            self.assertNotIn(str(self.dist), path.read_text(encoding="utf-8"))

    def test_uninstall_removes_only_owned_files(self):
        self.assertEqual(self.run_script("install.sh").returncode, 0)
        unrelated = self.home / ".local/share/applications/unrelated.desktop"
        unrelated.parent.mkdir(parents=True, exist_ok=True)
        unrelated.write_text("keep", encoding="utf-8")

        result = self.run_script("uninstall.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.home / ".local/share/steambooster-linux").exists())
        self.assertFalse((self.home / ".local/share/applications/steambooster.desktop").exists())
        self.assertTrue(unrelated.is_file())


if __name__ == "__main__":
    unittest.main()
