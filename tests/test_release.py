import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
LOCAL_HOME = str(Path.home())


class ReleaseBuilderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.source = root / "source"
        self.output = root / "artifacts"
        self.required = (
            "booster-framework/out/booster-framework.js",
            "booster-framework/linux-launcher/dist/index.js",
            "booster-framework/linux-launcher/dist/handlers/config.js",
            "booster-framework/linux-launcher/dist/handlers/index.js",
            "booster-framework/linux-tray/run-tray.py",
            "booster-framework/linux-tray/probe.mjs",
            "booster-framework/linux-tray/steambooster_tray/__init__.py",
            "booster-framework/linux-tray/steambooster_tray/app.py",
            "booster-framework/linux-tray/steambooster_tray/model.py",
            "booster-framework/linux-tray/steambooster_tray/presentation.py",
            "booster-framework/linux-tray/steambooster_tray/supervisor.py",
            "steambooster-plugins/packages/booster-checkout/out/booster-checkout-0.0.12.js",
            "steambooster-plugins/packages/booster-checkout/out/booster-checkout-0.0.12.meta.json",
            "steambooster-plugins/packages/booster-addfunds/out/booster-addfunds-0.0.9.js",
            "steambooster-plugins/packages/booster-addfunds/out/booster-addfunds-0.0.9.meta.json",
        )
        for relative in self.required:
            path = self.source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"fixture {relative}\n", encoding="utf-8")
        (self.source / "booster-framework/LICENSE").write_text("MIT fixture\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def build(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "python", str(REPO / "scripts/build_release.py"),
                "--source-root", str(self.source),
                "--output-dir", str(self.output),
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_builder_creates_sanitized_zip_and_checksum(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        archive = self.output / "SteamBooster-Linux-x86_64.zip"
        self.assertTrue(archive.is_file())
        self.assertRegex((self.output / "SHA256SUMS").read_text(), r"^[0-9a-f]{64}  SteamBooster-Linux-x86_64\.zip\n$")
        with zipfile.ZipFile(archive) as bundle:
            names = bundle.namelist()
            self.assertIn("SteamBooster-Linux-x86_64/install.sh", names)
            self.assertIn("SteamBooster-Linux-x86_64/README_RU.md", names)
            self.assertIn("SteamBooster-Linux-x86_64/LICENSE", names)
            self.assertIn("SteamBooster-Linux-x86_64/LICENSES/SteamBalance-MIT.txt", names)
            self.assertIn(
                b"GNU GENERAL PUBLIC LICENSE",
                bundle.read("SteamBooster-Linux-x86_64/LICENSE"),
            )
            self.assertIn("SteamBooster-Linux-x86_64/payload/source/booster-framework/linux-launcher/dist/index.js", names)
            self.assertIn("SteamBooster-Linux-x86_64/payload/source/steambooster-plugins/packages/booster-checkout/out/booster-checkout.js", names)
            self.assertFalse(any("__pycache__" in name or name.endswith(".map") or "/tests/" in name for name in names))
            all_text = b"".join(bundle.read(name) for name in names if not name.endswith("/"))
            self.assertNotIn(LOCAL_HOME.encode(), all_text)

    def test_builder_rejects_local_home_paths(self):
        target = self.source / "booster-framework/out/booster-framework.js"
        target.write_text(f"const local = '{LOCAL_HOME}/private';\n", encoding="utf-8")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
