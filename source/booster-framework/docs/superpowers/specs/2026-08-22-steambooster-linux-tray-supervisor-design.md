# SteamBooster Linux Tray Supervisor — Design

**Date:** 2026-08-22

**Status:** Approved architecture; awaiting written-spec review

**Scope:** Linux launcher, KDE tray supervisor, autostart, and integration of official `1.0.2` framework/plugins

## Goal

Deliver a resilient Linux version of SteamBooster that preserves the complete behavior of the official `1.0.2` framework and required plugins while adding Linux-specific lifecycle management:

- keep `booster-checkout`, `booster-addfunds`, and `booster-rateaccount` functional;
- restore Main and Web injections after Steam restarts its CEF processes;
- expose health and recovery through a KDE system-tray icon;
- automatically repair Booster without closing Steam or running games;
- retain an explicit, separate action for restarting Steam when the user chooses it.

## Current Failure and Root Cause

At login, the XDG autostart entry launches `steambooster-steam`. The wrapper starts Steam with CDP enabled and then runs the local Node launcher. Initial injection succeeds.

Steam can later restart its client/CEF processes, for example after an internal update. The launcher continues running and sees the new CDP targets over HTTP, but its `MasterCDPSession` WebSocket remains bound to the old `SharedJSContext`. It then hangs while attaching to the new Main target. Web page modifications may still be visible while `booster-checkout` is absent from the new Main context, so the header button and popup disappear.

The launcher currently treats process liveness as health. A live Node PID therefore masks a dead CDP session.

## Upstream Baseline

The implementation will integrate the official upstream versions before completing the Linux supervisor:

- `booster-framework`: local `0.0.25` to official `1.0.2`;
- `booster-checkout`: local `0.0.12` to official `1.0.2`;
- `booster-addfunds`: local `0.0.9` to official `1.0.2`;
- `booster-rateaccount`: local `0.0.1` to official `1.0.0`, which is the rate-account version carried by the official plugin repository at its `1.0.2` checkout/addfunds state.

The official repositories remain the source of truth for framework and plugin behavior. The Linux launcher and tray are a local platform layer and must not fork or replace plugin business logic.

Existing uncommitted Linux and plugin changes must be preserved. Before integration, the implementation will record repository status and create recoverable snapshots of local diffs. Upstream changes will be merged file-by-file where overlaps exist, followed by the full framework and per-plugin test suites.

## Architecture

### 1. Tray supervisor

A lightweight Python application using the already-installed PyQt6 runtime owns the Linux lifecycle UI. It uses `QSystemTrayIcon` and runs for the desktop session.

Responsibilities:

- start Steam with CDP flags when Steam is not running;
- start and supervise the Node launcher as a child process;
- read launcher health and show the current state;
- automatically restart only the launcher when health remains bad;
- provide manual recovery, log, Steam restart, and exit actions;
- forward `steam://` arguments from desktop shortcuts to Steam.

The tray never implements framework or plugin behavior.

### 2. Reconnectable Node launcher

The Node launcher owns CDP discovery, framework injection, plugin injection, the Linux native-operation bridge, and cross-target bus forwarding.

Its top-level lifecycle becomes generation-based:

1. Wait for the CDP endpoint.
2. Discover the current `SharedJSContext` and Main target.
3. Create a fresh `MasterCDPSession` for that Steam generation.
4. Inject Shared, Main, and eligible Web contexts.
5. Monitor the master WebSocket and target identities.
6. On disconnect or Shared-context replacement, tear down generation-local state and return to step 1.

Generation-local state includes active bus targets, attached session IDs, injected target IDs, URL caches, intervals, and bridge loops. No state from a dead Steam generation may be reused.

### 3. Health contract

The launcher publishes an atomic JSON status file under `$XDG_RUNTIME_DIR/steambooster/status.json`. It contains no credentials or user data.

Required fields:

- schema version;
- launcher PID;
- Unix heartbeat timestamp plus an incrementing heartbeat sequence (the tray also validates the status-file modification age);
- state (`starting`, `connecting`, `injecting`, `healthy`, `recovering`, `error`);
- current Steam generation identifier;
- Shared/Main/Web injection summaries;
- `booster-checkout` registration status;
- header-button presence status;
- last error category and redacted message.

The tray treats the launcher as healthy only when the heartbeat is fresh, the Main context is injected, `booster-checkout` is registered, and the header button is present. Web injection health is reported separately so the tray can show degraded status without confusing it with the missing Main overlay.

### 4. Autostart and command routing

The XDG autostart entry starts the tray supervisor. Desktop Steam shortcuts invoke a small wrapper that:

- forwards URLs to a running Steam instance;
- asks the running tray to ensure Booster is active;
- starts the tray when it is absent.

Only one tray and one launcher instance may run per desktop session. A lock under `$XDG_RUNTIME_DIR/steambooster/` enforces this.

Restarting the launcher must not terminate Steam. Steam restart is a separate explicit tray command with confirmation when games are running or when safe detection is unavailable.

## Tray Experience

### Icon states

- **Green — Working:** Main checkout overlay and required Web injections are healthy.
- **Yellow — Connecting/Recovering:** Steam is starting, injection is in progress, or automatic repair is running.
- **Red — Error:** recovery budget is exhausted or Steam lacks the required CDP flags.
- **Gray — Steam stopped:** tray is available but Steam is not running.

The tooltip includes a short status and the installed framework/plugin versions.

### Menu

- non-clickable status summary;
- `Restore overlay now` — performs a fresh launcher recovery cycle;
- `Restart Booster` — restarts only the Node launcher;
- `Open Steam` — starts or focuses Steam;
- `Open log` — opens the current combined tray/launcher journal;
- `Restart Steam…` — explicit destructive-to-session action, never automatic;
- `Quit tray` — stops tray and launcher but leaves Steam running.

### Notifications

Notifications are emitted only for meaningful transitions:

- automatic recovery succeeded;
- automatic recovery failed after the retry budget;
- Steam is running without CDP and requires an explicit restart.

Routine startup and healthy polling remain silent.

## Automatic Recovery

The tray samples health every five seconds. To avoid recovery loops during normal startup:

- startup/injection receives a 30-second grace window;
- three consecutive unhealthy samples are required before an automatic launcher restart;
- automatic restarts use bounded exponential backoff;
- at most three automatic launcher restarts occur in a ten-minute window;
- after the budget is exhausted, the state becomes red and recovery requires manual action or a new Steam generation.

The preferred recovery path is internal Node reconnection. Process restart is the fallback for a stale heartbeat, crashed launcher, or recovery cycle that does not reach healthy state.

## Error Handling and Safety

- Errors written to status and notifications are redacted and bounded in length.
- A malformed or missing status file is unhealthy but never crashes the tray.
- Stale runtime files are removed only after validating ownership and recorded PID state.
- Launcher termination is graceful first, then forced only for the exact recorded child PID after a timeout.
- No automatic path sends `steam -shutdown`, kills Steam processes, or interrupts games.
- If Steam is already running without CDP flags, the tray reports the condition and offers an explicit Steam restart; it does not silently restart Steam.
- Repository integration never discards dirty-worktree changes. No reset/checkout of user changes is permitted.

## Logging

Tray and launcher logs use structured, timestamped lines and rotate under the user state directory. Logs distinguish:

- Steam process lifecycle;
- CDP endpoint lifecycle;
- Steam generation transitions;
- Shared/Main/Web injection results;
- plugin registration and header-button verification;
- automatic and manual recovery decisions.

Sensitive API payloads, auth tokens, payment identifiers, and personal account data are not logged.

## Testing

### Unit tests

- health-state parsing and state transitions;
- stale heartbeat detection;
- retry budget and backoff;
- single-instance locking;
- safe PID validation;
- launcher generation teardown and state reset;
- master WebSocket disconnect/reconnect behavior;
- status-file schema and atomic writes;
- URL forwarding and command routing.

### Integration tests

- initial Steam/CDP startup reaches healthy state;
- replacing Shared/Main target IDs causes a fresh generation and reinjection;
- Main injection failure with working Web injection reports degraded/red rather than healthy;
- missing checkout button triggers recovery;
- launcher restart leaves Steam PID unchanged;
- manual Steam restart is never reached from automatic recovery;
- tray restart reconnects to an already-running Steam instance.

### Regression and compatibility tests

- full `booster-framework` test suite at official `1.0.2` baseline;
- complete tests for checkout, addfunds, and rateaccount;
- production builds for framework and all required plugins;
- live KDE/Wayland smoke test for tray icon, menu actions, Main button, popup, store page modifications, cart top-up, catalogue/keys flow, and rate-account navigation.

## Rollout

1. Snapshot local repository changes and record the current working setup.
2. Integrate official `1.0.2` framework and plugin histories without discarding local work.
3. Rebuild and test the unmodified upstream behavior on Linux.
4. Add launcher reconnection and health reporting with red-green tests.
5. Add tray supervisor and autostart routing with red-green tests.
6. Run full automated suites and live KDE smoke tests.
7. Switch autostart to the tray only after the new supervisor passes live recovery testing.
8. Keep a recoverable copy of the prior autostart/wrapper configuration for rollback.

## Acceptance Criteria

- After login, Steam starts with Booster and the `Пополнить` button appears.
- When Steam replaces its CEF/Main contexts, Booster recovers automatically without restarting Steam.
- The tray accurately distinguishes healthy, recovering, error, and Steam-stopped states.
- `Restart Booster` restores the overlay while preserving the Steam PID and running games.
- All official `1.0.2` framework/plugin tests and builds pass after integration.
- Checkout popup, addfunds pages, cart behavior, catalogue/keys purchase flow, rate-account navigation, region, and currency functionality remain available.
- Existing local changes are preserved or explicitly reconciled; none are silently lost.
