"""Run continuous workers for sensor monitoring."""

from __future__ import annotations

import threading
import time

from app.config import get_settings
from app.workers import sensor_worker


def main() -> None:
    settings = get_settings()
    threads = []

    if settings.sensor_worker_enabled:
        threads.append(threading.Thread(target=sensor_worker.run, daemon=True, name="sensor-worker"))

    if not threads:
        raise RuntimeError("No workers enabled. Set SENSOR_WORKER_ENABLED true.")

    for t in threads:
        t.start()

    while True:
        for t in threads:
            if not t.is_alive():
                raise RuntimeError(f"Worker thread crashed: {t.name}")
        time.sleep(2)


if __name__ == "__main__":
    main()
