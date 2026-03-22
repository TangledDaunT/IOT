# OpenClaw — Wi-Fi CSI Spatial Radar

Zero-hardware presence sensor using ESP32 Channel State Information (CSI).
Detects presence, movement direction, and breathing rate from Wi-Fi signal distortion alone.

```
Y = HX + N
```
The H matrix (CSI) encodes how your body distorts every multipath Wi-Fi reflection.
We extract amplitude/phase per subcarrier, compute variance, apply a bandpass FFT,
and stream the results to a military-style radar dashboard in your browser.

---

## Architecture

```
ESP32 (CSI firmware)
  │  Serial USB @ 921600 baud
  ▼
server.py  (pyserial + numpy/scipy SVM + WebSocket server)
  │  ws://localhost:8765
  ▼
dashboard/index.html  (radar canvas + waterfall + spectrum)
```

---

## 1. Flash the ESP32

### Requirements
- **ESP32 (original)** — NOT S2/S3/C3. The vanilla dual-core ESP32 has the best
  CSI API support via `esp_wifi_set_csi()`.
- ESP-IDF v5.0+ installed: https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/

### Configure
Edit `esp32_firmware/main/app_main.c`:
```c
#define WIFI_SSID   "YOUR_WIFI_SSID"
#define WIFI_PASS   "YOUR_WIFI_PASSWORD"
#define PING_TARGET "192.168.1.1"   // Your router's IP
```

### Build & Flash
```bash
cd esp32_firmware
idf.py set-target esp32
idf.py menuconfig      # optional: increase UART buffer under Component Config > ESP System
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

You should see lines like:
```
CSI,1234,−62,64,18,22,19,25,21,30,...
```
That's: `CSI,<timestamp_ms>,<rssi>,<num_subcarriers>,<amp_0>,<amp_1>,...`

---

## 2. Run the Python Server

```bash
cd server
pip install -r requirements.txt

# Real hardware:
python server.py --port /dev/ttyUSB0 --baud 921600

# macOS:
python server.py --port /dev/cu.usbserial-XXXX

# Windows:
python server.py --port COM3

# No ESP32? Demo/simulation mode:
python server.py --demo
```

The server broadcasts JSON over WebSocket at `ws://localhost:8765` at ~15 fps.

---

## 3. Open the Dashboard

Just open `dashboard/index.html` in your browser.
No build step, no npm, no framework — pure HTML/CSS/JS.

```bash
open dashboard/index.html       # macOS
xdg-open dashboard/index.html  # Linux
```

Or serve it (required if browser blocks `file://` WebSocket):
```bash
cd dashboard
python -m http.server 8080
# then visit http://localhost:8080
```

---

## What You See

| Panel | Description |
|---|---|
| **Radar sweep** | Rotating phosphor sweep. Blips spawn when CSI variance is elevated — brighter = more disturbance |
| **Presence indicator** | Green = occupied, amber = active motion, grey = vacant |
| **Breathing rate (BPM)** | Bandpass FFT on 0.1–0.5 Hz of CSI mean amplitude. Only shown when still + present |
| **Variance gauge** | Raw signal variance. >3.5 = presence, >8.0 = movement |
| **Subcarrier spectrum** | Live amplitude per Wi-Fi subcarrier (64 bars for LLTF) |
| **CSI Waterfall** | Time × subcarrier heatmap. Movement appears as bright streaks |
| **Variance history** | 8-second sparkline of variance with threshold overlays |

---

## Signal Processing Details

```
CSI buffer  →  amplitude[i] = √(I² + Q²) per subcarrier
            →  mean_amp = average across all subcarriers
            →  variance(window=100) → presence/motion thresholds
            →  bandpass(0.1–0.5Hz) + rfft → breathing BPM
```

### Thresholds (tunable in server.py)
```python
PRESENCE_THRESH = 3.5   # empty room variance is ~0.5–1.5
MOVEMENT_THRESH = 8.0   # walking = 10–50, breathing = 3–8
```

### Breathing Rate
Uses a 4th-order Butterworth bandpass filter (0.1–0.5 Hz = 6–30 breaths/min)
followed by an FFT peak-frequency extraction. Requires ~15 seconds of still
presence to stabilise.

---

## Limitations

- **Single room, single person** — multipath CSI is a room-level sensor, not
  a per-person tracker without antenna arrays.
- **Wall penetration** — signal passes through drywall; this is also a feature
  (monitor a sleeping person from adjacent room).
- **Router dependency** — ESP32 must be associated to a 2.4 GHz access point.
  5 GHz does not work (ESP32 is 2.4 GHz only).
- **Interference** — microwave ovens, Bluetooth, other 2.4 GHz devices will
  add noise.

---

## Next Steps

- **SVM training mode**: Collect labelled CSI windows (vacant/present/walking),
  extract features (variance, kurtosis, mean, std per subcarrier band),
  train `sklearn.svm.SVC`, pickle it, load in `server.py`.
- **Multiple ESP32s**: Triangulate position from 3+ nodes for room-level XY tracking.
- **MQTT bridge**: Publish presence events to Home Assistant.
- **n8n integration**: Trigger automations (lights, alerts) on presence state change.
