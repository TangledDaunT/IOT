"""YOLO + face recognition vision worker posting room state to FastAPI bridge."""

from __future__ import annotations

import base64
import time
from pathlib import Path
from typing import Any

import cv2
import face_recognition
import requests
from ultralytics import YOLO

WEBCAM_INDEX = 0
SCAN_INTERVAL = 2
IOT_BRIDGE = "http://localhost:8088"
YOLO_CONF_THRESHOLD = 0.5
YOUR_FACE_PATH = "edge_assistant/my_face.jpg"
STRANGER_ALERT_COOLDOWN = 120
WORKER_ROOT = Path(__file__).resolve().parents[1]


def _log(message: str) -> None:
    print(f"[VISION] {message}", flush=True)


def _load_known_face_encoding(photo_path: str) -> Any | None:
    path = Path(photo_path)
    if not path.exists():
        path = WORKER_ROOT / "my_face.jpg"
    if not path.exists():
        _log(f"warning: face reference image not found at {photo_path} (or {path}); recognition disabled")
        return None

    image = face_recognition.load_image_file(str(path))
    encodings = face_recognition.face_encodings(image)
    if not encodings:
        _log("warning: no face encoding found in reference image; recognition disabled")
        return None
    _log("loaded reference face encoding")
    return encodings[0]


def _post_json(endpoint: str, payload: dict[str, Any]) -> None:
    try:
        requests.post(f"{IOT_BRIDGE}{endpoint}", json=payload, timeout=10)
    except Exception as exc:
        _log(f"post failed endpoint={endpoint}: {exc}")


def _post_stranger_alert(frame_bgr: Any) -> None:
    try:
        ok, encoded = cv2.imencode(".jpg", frame_bgr)
        if not ok:
            _log("failed to encode stranger frame")
            return
        image_b64 = base64.b64encode(encoded.tobytes()).decode("utf-8")
        _post_json("/room/stranger_alert", {"image_bytes_b64": image_b64})
    except Exception as exc:
        _log(f"stranger alert failed: {exc}")


def _detect_people(model: YOLO, frame_bgr: Any) -> list[tuple[int, int, int, int, float]]:
    results = model(frame_bgr, verbose=False)
    people_boxes: list[tuple[int, int, int, int, float]] = []
    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            cls_id = int(box.cls.item())
            conf = float(box.conf.item())
            if cls_id != 0 or conf < YOLO_CONF_THRESHOLD:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            people_boxes.append((int(x1), int(y1), int(x2), int(y2), conf))
    return people_boxes


def _detect_faces(frame_bgr: Any, known_encoding: Any | None) -> tuple[bool, bool]:
    if known_encoding is None:
        return False, False

    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb, model="hog")
    if not locations:
        return False, False

    encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)
    you_detected = False
    stranger_detected = False
    for enc in encodings:
        matches = face_recognition.compare_faces([known_encoding], enc, tolerance=0.5)
        if any(matches):
            you_detected = True
        else:
            stranger_detected = True
    return you_detected, stranger_detected


def run() -> None:
    model = YOLO("yolov8n.pt")
    known_encoding = _load_known_face_encoding(YOUR_FACE_PATH)
    cap = cv2.VideoCapture(WEBCAM_INDEX)
    if not cap.isOpened():
        _log("webcam open failed")
        return

    prev_people = 0
    stranger_cooldown_until = 0.0

    _log("worker started")

    while True:
        loop_start = time.time()
        try:
            ok, frame = cap.read()
            if not ok or frame is None:
                _log("failed to capture frame")
                time.sleep(SCAN_INTERVAL)
                continue

            people_boxes = _detect_people(model, frame)
            people_count = len(people_boxes)
            you_detected, stranger_detected = _detect_faces(frame, known_encoding)

            standing_detected = False
            for x1, y1, x2, y2, _ in people_boxes:
                width = max(x2 - x1, 1)
                height = max(y2 - y1, 1)
                ratio = height / float(width)
                if ratio > 2.0:
                    standing_detected = True
                    break

            state_payload = {
                "people_in_room": people_count,
                "you_are_present": you_detected,
                "strangers_present": stranger_detected,
                "alarm_can_stop": bool(people_count > 0 and standing_detected),
                "last_updated": time.time(),
            }
            _post_json("/room/state", state_payload)

            if stranger_detected and not you_detected and time.time() >= stranger_cooldown_until:
                _post_stranger_alert(frame)
                stranger_cooldown_until = time.time() + STRANGER_ALERT_COOLDOWN

            if prev_people > 0 and people_count == 0:
                _post_json("/room/power_saving", {"enabled": True})

            if prev_people == 0 and people_count > 0:
                _post_json("/room/power_saving", {"enabled": False})
                _post_json("/room/announce", {"message": "Hello! Someone has entered the room."})

            prev_people = people_count
        except Exception as exc:
            _log(f"loop error: {exc}")
        finally:
            elapsed = time.time() - loop_start
            if elapsed < SCAN_INTERVAL:
                time.sleep(SCAN_INTERVAL - elapsed)
            else:
                time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    run()
