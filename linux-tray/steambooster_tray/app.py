from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PyQt6.QtCore import QObject, QLockFile, QRunnable, QThreadPool, QTimer, QUrl, pyqtSignal, pyqtSlot
from PyQt6.QtGui import QAction, QColor, QDesktopServices, QFont, QIcon, QPainter, QPixmap
from PyQt6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

from .model import HealthSnapshot, HealthState, RecoveryDecision, RecoveryPolicy
from .presentation import MENU_LABELS, state_color
from .supervisor import BoosterSupervisor


@dataclass(frozen=True)
class TrayPaths:
    tray_root: Path
    probe: Path
    log: Path

    @classmethod
    def from_tray_root(cls, tray_root: Path) -> "TrayPaths":
        workspace = tray_root.parents[2]
        return cls(
            tray_root=tray_root,
            probe=tray_root / "probe.mjs",
            log=workspace / "docs" / "artifacts" / "logs" / "launcher.log",
        )


def runtime_lock_path() -> Path:
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    return Path(runtime_dir) / "steambooster" / "tray.lock"


def is_recoverable(snapshot: HealthSnapshot) -> bool:
    return snapshot.steam_available and snapshot.cdp_available and snapshot.state in {
        HealthState.RECOVERING,
        HealthState.FAILED,
    }


class ActionGate:
    def __init__(self) -> None:
        self._active = False

    def enter(self) -> bool:
        if self._active:
            return False
        self._active = True
        return True

    def leave(self) -> None:
        self._active = False


def make_icon(state: HealthState) -> QIcon:
    pixmap = QPixmap(64, 64)
    pixmap.fill(QColor("transparent"))
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setBrush(QColor(state_color(state)))
    painter.setPen(QColor("#111827"))
    painter.drawEllipse(4, 4, 56, 56)
    painter.setPen(QColor("white"))
    font = QFont("Sans Serif", 27, QFont.Weight.Bold)
    painter.setFont(font)
    painter.drawText(pixmap.rect(), 0x84, "B")
    painter.end()
    return QIcon(pixmap)


class TaskSignals(QObject):
    succeeded = pyqtSignal(object)
    failed = pyqtSignal(str)


class BackgroundTask(QRunnable):
    def __init__(self, function: Callable[[], object]) -> None:
        super().__init__()
        self.function = function
        self.signals = TaskSignals()

    @pyqtSlot()
    def run(self) -> None:
        try:
            self.signals.succeeded.emit(self.function())
        except Exception as error:  # GUI boundary: surface errors in the tray.
            self.signals.failed.emit(str(error))


class TrayController(QObject):
    def __init__(self, application: QApplication, paths: TrayPaths) -> None:
        super().__init__()
        self.application = application
        self.paths = paths
        self.supervisor = BoosterSupervisor(paths.probe, paths.log)
        self.recovery_policy = RecoveryPolicy()
        self.thread_pool = QThreadPool.globalInstance()
        self.health_task_running = False
        self.action_gate = ActionGate()
        self.active_tasks: set[BackgroundTask] = set()
        self.last_generation: str | None = None

        self.tray = QSystemTrayIcon(make_icon(HealthState.STEAM_UNAVAILABLE), self)
        self.tray.setToolTip("SteamBooster — проверка состояния")
        self.menu = QMenu()
        self.status_action = QAction("Статус: проверка…", self.menu)
        self.status_action.setEnabled(False)
        self.menu.addAction(self.status_action)
        self.menu.addSeparator()
        self.recovery_actions = [
            self._add_action(MENU_LABELS["restore"], self.restore_overlay),
            self._add_action(MENU_LABELS["restart"], self.restart_booster),
        ]
        self.menu.addSeparator()
        self._add_action(MENU_LABELS["open_steam"], self.open_steam)
        self._add_action(MENU_LABELS["open_log"], self.open_log)
        self.menu.addSeparator()
        self._add_action(MENU_LABELS["quit"], self.application.quit)
        self.tray.setContextMenu(self.menu)
        self.tray.activated.connect(self._activated)

        self.timer = QTimer(self)
        self.timer.setInterval(5000)
        self.timer.timeout.connect(self.refresh_health)

    def _add_action(self, label: str, callback: Callable[[], None]) -> QAction:
        action = QAction(label, self.menu)
        action.triggered.connect(callback)
        self.menu.addAction(action)
        return action

    def _start_task(self, task: BackgroundTask) -> None:
        self.active_tasks.add(task)
        task.signals.succeeded.connect(lambda _result, active=task: self.active_tasks.discard(active))
        task.signals.failed.connect(lambda _message, active=task: self.active_tasks.discard(active))
        self.thread_pool.start(task)

    def start(self) -> None:
        self.tray.show()
        self.timer.start()
        self._run_action(self.supervisor.ensure_launcher, "Booster запускается…")
        QTimer.singleShot(1200, self.refresh_health)

    def refresh_health(self) -> None:
        if self.health_task_running:
            return
        self.health_task_running = True
        task = BackgroundTask(self.supervisor.health)
        task.signals.succeeded.connect(self._health_ready)
        task.signals.failed.connect(self._health_failed)
        self._start_task(task)

    def _health_ready(self, result: object) -> None:
        self.health_task_running = False
        if not isinstance(result, HealthSnapshot):
            self._health_failed("Некорректный результат проверки")
            return
        self._set_state(result.state, result.detail)
        now = time.monotonic()
        if (
            result.generation is not None
            and self.last_generation is not None
            and result.generation != self.last_generation
        ):
            self.recovery_policy.reset(now)
        self.last_generation = result.generation
        healthy_for_policy = not is_recoverable(result)
        decision = self.recovery_policy.observe(healthy_for_policy, now)
        if decision == RecoveryDecision.RESTART:
            self._run_action(self.supervisor.restart_launcher, "Автовосстановление Booster…")
        elif decision == RecoveryDecision.EXHAUSTED:
            self._set_state(HealthState.FAILED, "Лимит автовосстановления исчерпан")

    def _health_failed(self, message: str) -> None:
        self.health_task_running = False
        self._set_state(HealthState.FAILED, message or "Ошибка проверки Booster")

    def _set_state(self, state: HealthState, detail: str) -> None:
        self.tray.setIcon(make_icon(state))
        self.tray.setToolTip(f"SteamBooster — {detail}")
        self.status_action.setText(f"Статус: {detail}")

    def _run_action(self, action: Callable[[], object], pending_text: str) -> None:
        if not self.action_gate.enter():
            return
        for menu_action in self.recovery_actions:
            menu_action.setEnabled(False)
        self._set_state(HealthState.RECOVERING, pending_text)
        task = BackgroundTask(action)
        task.signals.succeeded.connect(self._action_succeeded)
        task.signals.failed.connect(self._action_failed)
        self._start_task(task)

    def _action_succeeded(self, _result: object) -> None:
        self.action_gate.leave()
        for menu_action in self.recovery_actions:
            menu_action.setEnabled(True)
        QTimer.singleShot(1200, self.refresh_health)

    def _action_failed(self, message: str) -> None:
        self.action_gate.leave()
        for menu_action in self.recovery_actions:
            menu_action.setEnabled(True)
        self._set_state(HealthState.FAILED, message or "Операция Booster не выполнена")
        self.tray.showMessage(
            "SteamBooster",
            message or "Не удалось выполнить операцию",
            QSystemTrayIcon.MessageIcon.Critical,
            5000,
        )

    def restore_overlay(self) -> None:
        self.recovery_policy.reset(time.monotonic())
        self._run_action(self.supervisor.restart_launcher, "Восстановление оверлея…")

    def restart_booster(self) -> None:
        self.recovery_policy.reset(time.monotonic())
        self._run_action(self.supervisor.restart_launcher, "Перезапуск Booster…")

    def open_steam(self) -> None:
        QDesktopServices.openUrl(QUrl("steam://store"))

    def open_log(self) -> None:
        self.paths.log.parent.mkdir(parents=True, exist_ok=True)
        self.paths.log.touch(exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(self.paths.log)))

    def _activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self.restore_overlay()


def main() -> int:
    application = QApplication(sys.argv)
    application.setApplicationName("SteamBooster Tray")
    application.setQuitOnLastWindowClosed(False)

    lock_path = runtime_lock_path()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock = QLockFile(str(lock_path))
    lock.setStaleLockTime(0)
    if not lock.tryLock(100):
        return 0
    if not QSystemTrayIcon.isSystemTrayAvailable():
        print("SteamBooster: system tray is unavailable", file=sys.stderr)
        return 2

    tray_root = Path(__file__).resolve().parent.parent
    controller = TrayController(application, TrayPaths.from_tray_root(tray_root))
    controller.start()
    return application.exec()
