from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from .model import HealthSnapshot, HealthState, classify_health


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: str
    stderr: str


Runner = Callable[[Sequence[str], float], RunResult]


def run_command(args: Sequence[str], timeout: float) -> RunResult:
    completed = subprocess.run(
        list(args),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    return RunResult(completed.returncode, completed.stdout, completed.stderr)


class BoosterSupervisor:
    def __init__(
        self,
        probe_path: Path,
        log_path: Path,
        runner: Runner = run_command,
        unit_name: str = "steambooster-launcher.service",
    ) -> None:
        self.probe_path = probe_path
        self.log_path = log_path
        self.runner = runner
        self.unit_name = unit_name

    def health(self) -> HealthSnapshot:
        service = self.runner(
            ["systemctl", "--user", "is-active", "--quiet", self.unit_name],
            2,
        )
        launcher_active = service.returncode == 0
        try:
            probe = self.runner(["node", str(self.probe_path)], 4)
            data = json.loads(probe.stdout)
            if not isinstance(data, dict):
                raise ValueError("probe result is not an object")
            return classify_health(
                bool(data.get("steam_available")),
                launcher_active,
                bool(data.get("button_present")),
                cdp_available=bool(data.get("cdp_available")),
            )
        except (json.JSONDecodeError, OSError, subprocess.SubprocessError, ValueError):
            return HealthSnapshot(
                HealthState.FAILED,
                "Проверка Booster завершилась ошибкой",
                True,
                False,
                launcher_active,
                False,
            )

    def restart_launcher(self) -> None:
        result = self.runner(
            ["systemctl", "--user", "restart", self.unit_name],
            10,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Не удалось перезапустить Booster")

    def ensure_launcher(self) -> None:
        result = self.runner(
            ["systemctl", "--user", "start", self.unit_name],
            10,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Не удалось запустить Booster")
