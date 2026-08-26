#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path


PACKAGE_NAME = "SteamBooster-Linux-x86_64"
ARCHIVE_NAME = f"{PACKAGE_NAME}.zip"
LOCAL_HOME = str(Path.home()).encode()
FORBIDDEN = (LOCAL_HOME,)


PAYLOAD_FILES = {
    "booster-framework/out/booster-framework.js": "source/booster-framework/out/booster-framework.js",
    "booster-framework/linux-launcher/dist/index.js": "source/booster-framework/linux-launcher/dist/index.js",
    "booster-framework/linux-launcher/dist/handlers/config.js": "source/booster-framework/linux-launcher/dist/handlers/config.js",
    "booster-framework/linux-launcher/dist/handlers/index.js": "source/booster-framework/linux-launcher/dist/handlers/index.js",
    "booster-framework/linux-tray/run-tray.py": "source/booster-framework/linux-tray/run-tray.py",
    "booster-framework/linux-tray/probe.mjs": "source/booster-framework/linux-tray/probe.mjs",
    "booster-framework/linux-tray/steambooster_tray/__init__.py": "source/booster-framework/linux-tray/steambooster_tray/__init__.py",
    "booster-framework/linux-tray/steambooster_tray/app.py": "source/booster-framework/linux-tray/steambooster_tray/app.py",
    "booster-framework/linux-tray/steambooster_tray/model.py": "source/booster-framework/linux-tray/steambooster_tray/model.py",
    "booster-framework/linux-tray/steambooster_tray/presentation.py": "source/booster-framework/linux-tray/steambooster_tray/presentation.py",
    "booster-framework/linux-tray/steambooster_tray/supervisor.py": "source/booster-framework/linux-tray/steambooster_tray/supervisor.py",
    "steambooster-plugins/packages/booster-checkout/out/booster-checkout-0.0.12.js": "source/steambooster-plugins/packages/booster-checkout/out/booster-checkout.js",
    "steambooster-plugins/packages/booster-checkout/out/booster-checkout-0.0.12.meta.json": "source/steambooster-plugins/packages/booster-checkout/out/booster-checkout.meta.json",
    "steambooster-plugins/packages/booster-addfunds/out/booster-addfunds-0.0.9.js": "source/steambooster-plugins/packages/booster-addfunds/out/booster-addfunds.js",
    "steambooster-plugins/packages/booster-addfunds/out/booster-addfunds-0.0.9.meta.json": "source/steambooster-plugins/packages/booster-addfunds/out/booster-addfunds.meta.json",
}


def copy_file(source: Path, destination: Path, mode: int | None = None) -> None:
    if not source.is_file():
        raise RuntimeError(f"required file is missing: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    if mode is not None:
        destination.chmod(mode)


def scan_tree(root: Path) -> None:
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        data = path.read_bytes()
        if any(marker in data for marker in FORBIDDEN):
            raise RuntimeError(f"forbidden local path in {path.relative_to(root)}")


def write_deterministic_zip(root: Path, archive: Path) -> None:
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            relative = path.relative_to(root.parent).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(2026, 8, 26, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            mode = stat.S_IMODE(path.stat().st_mode)
            info.external_attr = (stat.S_IFREG | mode) << 16
            bundle.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def build(source_root: Path, output_dir: Path, repo_root: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="steambooster-release-", dir=output_dir) as temporary:
        package = Path(temporary) / PACKAGE_NAME
        package.mkdir()
        for name, mode in (("install.sh", 0o755), ("uninstall.sh", 0o755), ("README_RU.md", 0o644), ("README.md", 0o644)):
            copy_file(repo_root / name, package / name, mode)
        copy_file(repo_root / "scripts" / "render_install.py", package / "scripts" / "render_install.py", 0o755)
        copy_file(source_root / "booster-framework" / "LICENSE", package / "LICENSES" / "SteamBalance-MIT.txt")
        copy_file(repo_root / "THIRD_PARTY_NOTICES.md", package / "THIRD_PARTY_NOTICES.md")

        for source_name, destination_name in PAYLOAD_FILES.items():
            copy_file(source_root / source_name, package / "payload" / destination_name)
        (package / "payload" / "source" / "booster-framework" / "linux-launcher" / "package.json").write_text(
            '{"name":"steambooster-linux-runtime","private":true,"type":"module"}\n',
            encoding="utf-8",
        )
        scan_tree(package)

        archive = output_dir / ARCHIVE_NAME
        write_deterministic_zip(package, archive)

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    sums = output_dir / "SHA256SUMS"
    sums.write_text(f"{digest}  {ARCHIVE_NAME}\n", encoding="utf-8")
    return archive, sums


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the public SteamBooster Linux ZIP")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        archive, sums = build(args.source_root.resolve(), args.output_dir.resolve(), Path(__file__).resolve().parents[1])
        print(archive)
        print(sums)
        return 0
    except (OSError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"build error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
