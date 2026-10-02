# SteamBooster Linux

Unofficial community Linux build of the open-source SteamBooster framework and its required plugins. It adds the SteamBalance top-up UI, supported game purchase offers, the original catalog and account valuation flow, automatic recovery, and a desktop tray controller to the Linux Steam client.

The ready-to-install archive is available on the GitHub Releases page. See [README_RU.md](README_RU.md) for complete installation and troubleshooting instructions.

## Important

- This is not an official SteamBalance or Valve release.
- Payments are real operations handled by SteamBalance. Review the project and use it only if you understand and trust it.
- The project does not bypass regional, account, store, or payment restrictions.
- Never publish logs from `~/.local/share/steambooster-linux/docs/artifacts/logs/` without reviewing them.

If the project is useful, stars, issue reports, reproducible logs with personal data removed, and pull requests are welcome.

## License

The original packaging, installer, and integration code in this repository is licensed under [GNU GPL version 3 only](LICENSE) (`GPL-3.0-only`).

## Third-party notices

Bundled SteamBalance components retain their upstream MIT terms. Their mandatory notice is shipped separately in `LICENSES/SteamBalance-MIT.txt`; see `THIRD_PARTY_NOTICES.md`.

## Source layout and build

The `main` branch contains the complete Linux adaptation:

- `source/booster-framework/`: upstream framework and Linux launcher/tray.
- `source/steambooster-plugins/`: checkout, game offers and account valuation plugins.
- `scripts/`: portable package builder and installer.

Build from the repository root with Bun 1.3.14+, Node.js 22+ and Python 3.11+:

```bash
(cd source/booster-framework && bun install && bun run build)
(cd source/booster-framework/linux-launcher && bun install && bun run build)
(cd source/steambooster-plugins && bun install && bun run build)
python scripts/build_release.py --source-root source --output-dir docs/artifacts/release
```

The output directory contains the installable ZIP and `SHA256SUMS`. See
[README_RU.md](README_RU.md) for installation. Upstream component licenses are
retained inside their source directories; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
