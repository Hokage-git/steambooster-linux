#!/usr/bin/env bash
set -euo pipefail

BUNDLE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec python3 "$BUNDLE_ROOT/scripts/render_install.py" install --bundle-root "$BUNDLE_ROOT"
