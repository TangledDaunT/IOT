#!/usr/bin/env python3
"""
OpenClaw CSI Radar — Python Backend
=====================================
Reads CSI data from ESP32 over serial, processes it, and broadcasts
results to all connected browser clients over WebSocket.

Usage:
    python server.py --port /dev/ttyUSB0 --baud 921600 --ws-port 8765
#!/usr/bin/env python3
"""
OpenClaw CSI Radar — Python Backend
=====================================
Reads CSI data from ESP32 over serial, processes it, and broadcasts
results to all connected browser clients over WebSocket.

Usage:
    python server.py --port /dev/ttyUSB0 --baud 921600 --ws-port 8765

On macOS: /dev/cu.usbserial-XXXX
On Windows: COMx
On Linux: /dev/ttyUSB0 or /dev/ttyACM0

No ESP32? Demo mode:
    python server.py --demo

Install deps:
    pip install pyserial websockets numpy scipy scikit-learn
"""

import argparse
import asyncio
import json
import math
import time
import threading
import collections
import logging

import serial
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.fft import rfft, rfftfreq
import websockets
from websockets.server import WebSocketServerProtocol

# ── CONFIG ────────────────────────────────────────────────────────────────────
WINDOW_SIZE      = 100
BREATHE_WINDOW   = 300
SAMPLE_RATE      = 20.0
NUM_SUBCARRIERS  = 64
BREATH_LOW_HZ    = 0.1
BREATH_HIGH_HZ   = 0.5

# ── AUTO-CALIBRATION ──────────────────────────────────────────────────────────
# On startup, keep the room EMPTY for CALIB_SECS seconds.
# The server measures the empty-room variance baseline and sets
# thresholds relative to it — so it adapts to any room automatically.
CALIB_SECS       = 6
PRESENCE_OFFSET  = 0.7   # baseline + this = presence threshold
MOVEMENT_OFFSET  = 2.2   # baseline + this = movement threshold

# Fallback thresholds (used before calibration completes)
PRESENCE_THRESH  = 1.8
MOVEMENT_THRESH  = 4.5

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("CSI_RADAR")

# ── SHARED STATE ──────────────────────────────────────────────────────────────
class RadarState:
    def __init__(self):
        self.lock           = threading.Lock()
        self.amp_window     = collections.deque(maxlen=WINDOW_SIZE)
        self.breath_window  = collections.deque(maxlen=BREATHE_WINDOW)
        self.raw_history    = collections.deque(maxlen=200)

        self.presence       = False
        self.movement       = False
        self.variance       = 0.0
        self.breathing_bpm  = 0.0
        self.rssi           = -99
        self.num_sc         = 0
        self.subcarrier_amp = []
        self.waterfall      = []
        self.timestamp      = 0.0
        self.packet_count   = 0

        # Calibration
        self.calib_done     = False
        self.calib_start    = time.time()
        self.calib_samples  = []
        self.baseline_var   = 0.0
        self.presence_thresh = PRESENCE_THRESH
        self.movement_thresh = MOVEMENT_THRESH
        self.calib_status   = "CALIBRATING"
        self.calib_pct      = 0

state = RadarState()

# ── SIGNAL PROCESSING ─────────────────────────────────────────────────────────
def bandpass_butter(lowcut, highcut, fs, order=4):
    nyq = 0.5 * fs
    return butter(order, [lowcut / nyq, highcut / nyq], btype="band", output="sos")

BREATH_SOS = bandpass_butter(BREATH_LOW_HZ, BREATH_HIGH_HZ, SAMPLE_RATE)


def compute_metrics(amp_row: np.ndarray, rssi: int, sc_count: int):
    mean_amp = float(np.mean(amp_row))

    with state.lock:
        # ── Calibration phase ────────────────────────────────────────────────
        elapsed = time.time() - state.calib_start
        if not state.calib_done:
            state.calib_pct = min(100, int(elapsed / CALIB_SECS * 100))
            # Collect variance samples — but we need a mini-window to compute variance
            state.calib_samples.append(mean_amp)
            if elapsed >= CALIB_SECS and len(state.calib_samples) >= 20:
                arr = np.array(state.calib_samples)
                # Compute variance of the baseline signal
                baseline = float(np.var(arr))
                state.baseline_var   = round(baseline, 3)
                state.presence_thresh = round(baseline + PRESENCE_OFFSET, 3)
                state.movement_thresh = round(baseline + MOVEMENT_OFFSET, 3)
                state.calib_done     = True
                state.calib_status   = "READY"
                log.info(
                    f"Calibration complete. baseline_var={state.baseline_var:.3f}  "
                    f"presence_thresh={state.presence_thresh:.3f}  "
                    f"movement_thresh={state.movement_thresh:.3f}"
                )

        # ── Populate rolling buffers ─────────────────────────────────────────
        state.amp_window.append(mean_amp)
        state.breath_window.append(mean_amp)
        state.rssi          = rssi
        state.num_sc        = sc_count
        state.packet_count += 1
        state.timestamp     = time.time()

        row_norm = amp_row / (np.max(amp_row) + 1e-6) * 255
        row_list = row_norm.astype(int).tolist()
        state.raw_history.append(row_list)
        state.subcarrier_amp = row_list
        state.waterfall      = list(state.raw_history)[-60:]

        if len(state.amp_window) < 10:
            return

        arr      = np.array(state.amp_window)
        variance = float(np.var(arr))
        state.variance = round(variance, 2)

        pt = state.presence_thresh
        mt = state.movement_thresh
        state.presence = variance > pt
        state.movement = variance > mt

        # ── Breathing rate FFT ───────────────────────────────────────────────
        if (len(state.breath_window) >= BREATHE_WINDOW // 2
                and state.presence and not state.movement):
            signal = np.array(state.breath_window)
            signal -= np.mean(signal)
            try:
                filtered = sosfilt(BREATH_SOS, signal)
                fft_mag  = np.abs(rfft(filtered))
                freqs    = rfftfreq(len(filtered), d=1.0 / SAMPLE_RATE)
                mask     = (freqs >= BREATH_LOW_HZ) & (freqs <= BREATH_HIGH_HZ)
                if mask.any():
                    peak_freq = freqs[mask][np.argmax(fft_mag[mask])]
                    state.breathing_bpm = round(peak_freq * 60, 1)
            except Exception:
                pass
        elif not state.presence:
            state.breathing_bpm = 0.0


def snapshot() -> dict:
    with state.lock:
        return {
            "ts"            : round(state.timestamp * 1000),
            "presence"      : state.presence,
            "movement"      : state.movement,
            "variance"      : state.variance,
            "breathing"     : state.breathing_bpm,
            "rssi"          : state.rssi,
            "num_sc"        : state.num_sc,
            "subcarrier"    : state.subcarrier_amp,
            "waterfall"     : state.waterfall,
            "pkt_count"     : state.packet_count,
            "calib_done"    : state.calib_done,
            "calib_pct"     : state.calib_pct,
            "calib_status"  : state.calib_status,
            "baseline_var"  : state.baseline_var,
            "pres_thresh"   : state.presence_thresh,
            "move_thresh"   : state.movement_thresh,
        }

# ── SERIAL READER ─────────────────────────────────────────────────────────────
def serial_reader(port: str, baud: int):
    log.info(f"Opening serial port {port} @ {baud} baud ...")
    while True:
        try:
            with serial.Serial(port, baud, timeout=2) as ser:
                log.info("Serial connected. Waiting for ESP32 ...")
                while True:
                    try:
                        raw = ser.readline().decode("ascii", errors="ignore").strip()
                    except Exception as e:
                        log.warning(f"Serial read error: {e}")
                        break

                    if not raw.startswith("CSI,"):
                        if raw:
                            log.debug(f"ESP32: {raw}")
                        continue

                    parts = raw.split(",")
                    if len(parts) < 5:
                        continue
                    try:
                        rssi   = int(parts[2])
                        num_sc = int(parts[3])
                        amps   = np.array([float(x) for x in parts[4:]], dtype=np.float32)
                        if len(amps) == 0:
                            continue
                        compute_metrics(amps, rssi, num_sc)
                    except ValueError:
                        continue

        except serial.SerialException as e:
            log.error(f"Serial error: {e}. Retrying in 3s ...")
            time.sleep(3)

# ── DEMO / SIMULATION MODE ────────────────────────────────────────────────────
def demo_generator():
    """
    Realistic simulation that keeps you always present.
    Cycle: 8s still+breathing → 7s walking → 5s still → repeat.
    No vacant phase — you are always in the room.
    """
    log.info("DEMO MODE: Generating synthetic CSI data (always-present) ...")

    # First 6s: emit flat baseline noise so calibration measures it correctly
    baseline_secs = CALIB_SECS + 0.5
    t_start = time.time()
    phase = 0.0
    t = 0.0

    while True:
        elapsed = time.time() - t_start
        dt = 1.0 / SAMPLE_RATE

        if elapsed < baseline_secs:
            # Empty room during calibration window
            base  = 50.0
            noise = np.random.normal(0, 0.25, NUM_SUBCARRIERS)
        else:
            # Always present after calibration
            cycle = (elapsed - baseline_secs) % 20.0
            if cycle < 8:
                # Still — breathing at 14 BPM (0.233 Hz)
                phase += 2 * math.pi * 0.233 * dt
                breath = 3.5 * math.sin(phase)
                base   = 55.0 + breath
                noise  = np.random.normal(0, 0.7, NUM_SUBCARRIERS)
            elif cycle < 15:
                # Walking — high variance
                base  = 55.0 + np.random.normal(0, 4.5)
                noise = np.random.normal(0, 2.5, NUM_SUBCARRIERS)
            else:
                # Still again
                phase += 2 * math.pi * 0.233 * dt
                breath = 3.5 * math.sin(phase)
                base   = 55.0 + breath
                noise  = np.random.normal(0, 0.7, NUM_SUBCARRIERS)

        subcarrier_shape = np.sin(np.linspace(0, math.pi, NUM_SUBCARRIERS)) * 20
        amps = np.clip(base + subcarrier_shape + noise, 0, 127).astype(np.float32)
        compute_metrics(amps, rssi=-58, sc_count=NUM_SUBCARRIERS)
        time.sleep(dt)

# ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
CLIENTS: set = set()

async def ws_handler(ws: WebSocketServerProtocol):
    CLIENTS.add(ws)
    log.info(f"Client connected: {ws.remote_address}  (total={len(CLIENTS)})")
    try:
        await ws.send(json.dumps({"type": "hello", "msg": "OpenClaw CSI Radar"}))
        async for _ in ws:
            pass
    except websockets.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(ws)
        log.info(f"Client disconnected  (total={len(CLIENTS)})")


async def broadcast_loop(fps: float = 15.0):
    interval = 1.0 / fps
    while True:
        if CLIENTS:
            payload = json.dumps({"type": "radar", "data": snapshot()})
            dead = set()
            for ws in list(CLIENTS):
                try:
                    await ws.send(payload)
                except websockets.ConnectionClosed:
                    dead.add(ws)
            CLIENTS -= dead
        await asyncio.sleep(interval)


async def main(args):
    log.info(f"WebSocket server starting on ws://localhost:{args.ws_port}")
    async with websockets.serve(ws_handler, "0.0.0.0", args.ws_port):
        await broadcast_loop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenClaw CSI Radar Server")
    parser.add_argument("--port",    default="/dev/ttyUSB0")
    parser.add_argument("--baud",    default=921600, type=int)
    parser.add_argument("--ws-port", default=8765,   type=int)
    parser.add_argument("--demo",    action="store_true")
    args = parser.parse_args()

    if args.demo:
        t = threading.Thread(target=demo_generator, daemon=True)
    else:
        t = threading.Thread(target=serial_reader, args=(args.port, args.baud), daemon=True)
    t.start()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        log.info("Shutting down.")
On macOS the serial port is likely /dev/cu.usbserial-XXXX
On Windows it's COMx
On Linux it's /dev/ttyUSB0 or /dev/ttyACM0

Install deps:
    pip install pyserial websockets numpy scipy scikit-learn
"""

import argparse
import asyncio
import json
import math
import time
import threading
import collections
import logging
from typing import Optional

import serial
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.fft import rfft, rfftfreq
import websockets
from websockets.server import WebSocketServerProtocol

# ─── CONFIG ──────────────────────────────────────────────────────────────────
WINDOW_SIZE      = 100      # samples in rolling window for analysis
BREATHE_WINDOW   = 300      # larger window for breathing rate FFT
PRESENCE_THRESH  = 3.5      # variance threshold for presence detection
MOVEMENT_THRESH  = 8.0      # variance threshold for active movement
BREATH_LOW_HZ    = 0.1      # breathing: 6 breaths/min
BREATH_HIGH_HZ   = 0.5      # breathing: 30 breaths/min
SAMPLE_RATE      = 20.0     # ~20 pings/sec from ESP32
NUM_SUBCARRIERS  = 64       # typical ESP32 LLTF subcarrier count

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("CSI_RADAR")

# ─── SHARED STATE ────────────────────────────────────────────────────────────
class RadarState:
    def __init__(self):
        self.lock = threading.Lock()
        # Rolling buffers
        self.amp_window     : collections.deque = collections.deque(maxlen=WINDOW_SIZE)
        self.breath_window  : collections.deque = collections.deque(maxlen=BREATHE_WINDOW)
        self.raw_history    : collections.deque = collections.deque(maxlen=200)  # for waterfall

        # Derived metrics (written by serial thread, read by WS thread)
        self.presence       : bool  = False
        self.movement       : bool  = False
        self.variance       : float = 0.0
        self.breathing_bpm  : float = 0.0
        self.rssi           : int   = -99
        self.num_sc         : int   = 0
        self.subcarrier_amp : list  = []   # latest amplitude per subcarrier
        self.waterfall      : list  = []   # last N rows for heatmap
        self.timestamp      : float = 0.0
        self.packet_count   : int   = 0

state = RadarState()

# ─── SIGNAL PROCESSING ───────────────────────────────────────────────────────

def bandpass_butter(lowcut: float, highcut: float, fs: float, order: int = 4):
    """Return Butterworth bandpass SOS coefficients."""
    nyq = 0.5 * fs
    return butter(order, [lowcut / nyq, highcut / nyq], btype="band", output="sos")

BREATH_SOS = bandpass_butter(BREATH_LOW_HZ, BREATH_HIGH_HZ, SAMPLE_RATE)

def compute_metrics(amp_row: np.ndarray, rssi: int, sc_count: int):
    """Process one CSI amplitude row and update global state."""
    # Use mean amplitude across all subcarriers as scalar signal
    mean_amp = float(np.mean(amp_row))

    with state.lock:
        state.amp_window.append(mean_amp)
        state.breath_window.append(mean_amp)
        state.rssi      = rssi
        state.num_sc    = sc_count
        state.packet_count += 1
        state.timestamp = time.time()

        # Store raw for waterfall (normalise row to 0-255)
        row_norm = amp_row / (np.max(amp_row) + 1e-6) * 255
        row_list = row_norm.astype(int).tolist()
        state.raw_history.append(row_list)
        state.subcarrier_amp = row_list
        state.waterfall = list(state.raw_history)[-60:]  # last 60 rows

        if len(state.amp_window) < 10:
            return  # not enough data yet

        arr = np.array(state.amp_window)
        variance = float(np.var(arr))
        state.variance = round(variance, 2)
        state.presence = variance > PRESENCE_THRESH
        state.movement = variance > MOVEMENT_THRESH

        # Breathing rate via FFT (only when person is still/present)
        if len(state.breath_window) >= BREATHE_WINDOW // 2 and state.presence and not state.movement:
            signal = np.array(state.breath_window)
            signal -= np.mean(signal)  # detrend

            try:
                filtered = sosfilt(BREATH_SOS, signal)
                fft_mag  = np.abs(rfft(filtered))
                freqs    = rfftfreq(len(filtered), d=1.0 / SAMPLE_RATE)

                # Only look in breathing band
                mask = (freqs >= BREATH_LOW_HZ) & (freqs <= BREATH_HIGH_HZ)
                if mask.any():
                    peak_freq = freqs[mask][np.argmax(fft_mag[mask])]
                    state.breathing_bpm = round(peak_freq * 60, 1)
            except Exception:
                pass
        elif not state.presence:
            state.breathing_bpm = 0.0


def snapshot() -> dict:
    """Return a JSON-serialisable snapshot of the current radar state."""
    with state.lock:
        return {
            "ts"          : round(state.timestamp * 1000),
            "presence"    : state.presence,
            "movement"    : state.movement,
            "variance"    : state.variance,
            "breathing"   : state.breathing_bpm,
            "rssi"        : state.rssi,
            "num_sc"      : state.num_sc,
            "subcarrier"  : state.subcarrier_amp,
            "waterfall"   : state.waterfall,
            "pkt_count"   : state.packet_count,
        }

# ─── SERIAL READER ───────────────────────────────────────────────────────────

def serial_reader(port: str, baud: int):
    """
    Blocking loop: reads CSV lines from ESP32 and calls compute_metrics().
    Runs in its own daemon thread.
    Line format: CSI,<ts_ms>,<rssi>,<num_sc>,<amp_0>,<amp_1>,...
    """
    log.info(f"Opening serial port {port} @ {baud} baud ...")
    while True:
        try:
            with serial.Serial(port, baud, timeout=2) as ser:
                log.info("Serial connected. Waiting for ESP32 ...")
                while True:
                    try:
                        raw = ser.readline().decode("ascii", errors="ignore").strip()
                    except Exception as e:
                        log.warning(f"Serial read error: {e}")
                        break

                    if not raw.startswith("CSI,"):
                        if raw:
                            log.debug(f"ESP32: {raw}")
                        continue

                    parts = raw.split(",")
                    if len(parts) < 5:
                        continue

                    try:
                        # ts     = int(parts[1])   # ms (unused client-side)
                        rssi   = int(parts[2])
                        num_sc = int(parts[3])
                        amps   = np.array([float(x) for x in parts[4:]], dtype=np.float32)
                        if len(amps) == 0:
                            continue
                        compute_metrics(amps, rssi, num_sc)
                    except ValueError:
                        continue

        except serial.SerialException as e:
            log.error(f"Serial error: {e}. Retrying in 3s ...")
            time.sleep(3)

# ─── DEMO / SIMULATION MODE ──────────────────────────────────────────────────

def demo_generator():
    """
    Simulates CSI data so you can develop/test the dashboard without ESP32 hardware.
    Run with: python server.py --demo
    """
    log.info("DEMO MODE: Generating synthetic CSI data ...")
    t = 0.0
    phase = 0.0
    while True:
        t += 1.0 / SAMPLE_RATE

        # Simulate: absent for first 5s, then present + breathing, then moving
        cycle = t % 30.0
        if cycle < 5:
            # Empty room — low variance
            base = 50.0
            noise = np.random.normal(0, 0.3, NUM_SUBCARRIERS)
        elif cycle < 20:
            # Present, breathing at ~15 BPM (0.25 Hz)
            phase += 2 * math.pi * 0.25 / SAMPLE_RATE
            breath = 4.0 * math.sin(phase)
            base = 55.0 + breath
            noise = np.random.normal(0, 0.8, NUM_SUBCARRIERS)
        else:
            # Moving
            base = 55.0 + np.random.normal(0, 5.0)
            noise = np.random.normal(0, 3.0, NUM_SUBCARRIERS)

        subcarrier_shape = np.sin(np.linspace(0, math.pi, NUM_SUBCARRIERS)) * 20
        amps = np.clip(base + subcarrier_shape + noise, 0, 127).astype(np.float32)
        compute_metrics(amps, rssi=-55, sc_count=NUM_SUBCARRIERS)
        time.sleep(1.0 / SAMPLE_RATE)

# ─── WEBSOCKET SERVER ────────────────────────────────────────────────────────

CLIENTS: set[WebSocketServerProtocol] = set()

async def ws_handler(ws: WebSocketServerProtocol):
    CLIENTS.add(ws)
    log.info(f"Client connected: {ws.remote_address}  (total={len(CLIENTS)})")
    try:
        # Send a handshake
        await ws.send(json.dumps({"type": "hello", "msg": "OpenClaw CSI Radar"}))
        async for _ in ws:
            pass  # we only push, never pull
    except websockets.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(ws)
        log.info(f"Client disconnected  (total={len(CLIENTS)})")


async def broadcast_loop(fps: float = 15.0):
    """Push radar state to all connected clients at ~15 fps."""
    interval = 1.0 / fps
    while True:
        if CLIENTS:
            payload = json.dumps({"type": "radar", "data": snapshot()})
            # send to all, drop dead connections silently
            dead = set()
            for ws in list(CLIENTS):
                try:
                    await ws.send(payload)
                except websockets.ConnectionClosed:
                    dead.add(ws)
            CLIENTS.difference_update(dead)
        await asyncio.sleep(interval)


async def main(args):
    log.info(f"WebSocket server starting on ws://localhost:{args.ws_port}")
    async with websockets.serve(ws_handler, "0.0.0.0", args.ws_port):
        await broadcast_loop()

# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenClaw CSI Radar Server")
    parser.add_argument("--port",    default="/dev/ttyUSB0", help="ESP32 serial port")
    parser.add_argument("--baud",    default=921600, type=int, help="Serial baud rate")
    parser.add_argument("--ws-port", default=8765,   type=int, help="WebSocket port")
    parser.add_argument("--demo",    action="store_true",      help="Run in simulation mode (no ESP32 needed)")
    args = parser.parse_args()

    if args.demo:
        t = threading.Thread(target=demo_generator, daemon=True)
    else:
        t = threading.Thread(target=serial_reader, args=(args.port, args.baud), daemon=True)
    t.start()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        log.info("Shutting down.")
