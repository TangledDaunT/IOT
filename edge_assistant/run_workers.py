"""Run continuous workers for sensor monitoring."""

from __future__ import annotations

import subprocess
import sys
import threading
import time
from pathlib import Path

from app.config import get_settings
from app.workers import sensor_worker


workers_to_add = [
    ["python", "workers/vision_worker.py"],
    ["python", "workers/audio_worker.py"],
    ["python", "workers/alarm_worker.py"],
]


def main() -> None:
    settings = get_settings()
    threads = []
    processes: list[subprocess.Popen[str]] = []
    worker_root = Path(__file__).resolve().parent

    if settings.sensor_worker_enabled:
        threads.append(threading.Thread(target=sensor_worker.run, daemon=True, name="sensor-worker"))

    if not threads:
        raise RuntimeError("No workers enabled. Set SENSOR_WORKER_ENABLED true.")

    for t in threads:
        t.start()

    for worker_cmd in workers_to_add:
        cmd = [sys.executable if worker_cmd[0] == "python" else worker_cmd[0], *worker_cmd[1:]]
        process = subprocess.Popen(cmd, cwd=worker_root)
        processes.append(process)

    while True:
        for t in threads:
            if not t.is_alive():
                raise RuntimeError(f"Worker thread crashed: {t.name}")

        for process in processes:
            return_code = process.poll()
            if return_code is not None:
                raise RuntimeError(f"Worker process crashed: pid={process.pid} rc={return_code}")
        time.sleep(2)


if __name__ == "__main__":
    main()
