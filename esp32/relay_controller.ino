/**
 * relay_controller.ino - ESP32 smoke-aware relay controller.
 *
 * Hardware contract (active-LOW relays):
 *   Relay 1 -> GPIO26
 *   Relay 2 -> GPIO27
 *   Relay 3 -> GPIO25
 *   Relay 4 -> GPIO33
 *   MQ-2 AO -> GPIO34
 *
 * API contract for dashboard compatibility:
 *   GET  /relays/status
 *   POST /relays/toggle?id=X&state=1|0
 *   GET  /smoke/status
 *   POST /smoke/policy          (raw JSON body, Content-Type: application/json)
 *   GET  /health
 *   WS   /ws
 *
 * Boot behavior:
 *   1) Connect Wi-Fi (best effort with retry in loop).
 *   2) Calibrate clean-air baseline for 2 minutes.
 *   3) Turn relay 2 ON for 1 minute to learn smoke-air profile.
 *   4) Turn relay 2 OFF and enter normal operation.
 *
 * Smoke behavior:
 *   - If smoke is detected, relay 1 is forced OFF for safety hold period.
 *   - Relay 2 (fan) is automatically turned ON when smoke is detected,
 *     UNLESS the user has manually turned it OFF via the app.
 *   - Relay 2 is automatically turned OFF when the safety cooldown ends.
 *   - During active safety hold, relay 1 cannot be turned ON.
 *
 * Fan manual-override rule:
 *   - If the user turns relay 2 OFF via the app during a smoke episode,
 *     the auto-fan logic will not turn it back ON for that episode.
 *   - The manual-disable flag clears automatically when the cooldown ends,
 *     so the next smoke episode will auto-activate the fan again normally.
 *   - If the user turns relay 2 ON manually, the flag also clears.
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// ---------------------------
// Network configuration
// ---------------------------
const char *ssid     = "Sun6_2108";
const char *password = "11223344";
const char *hostname = "esp32";

// ---------------------------
// MQTT configuration
// ---------------------------
const char *MQTT_BROKER = "ad827adb37cb486d9a521c61763c31eb.s1.eu.hivemq.cloud";
const int   MQTT_PORT   = 8883;
const char *MQTT_USER   = "ESP32";
const char *MQTT_PASS   = "dazhop-Gexbej-1cuvcy";
const char *MQTT_TOPIC  = "Shreyansh/feeds/room-relay";

// ---------------------------
// Hardware pin map
// ---------------------------
static const int NUM_RELAYS  = 4;
static const int RELAY_1_ID  = 1;
static const int RELAY_2_ID  = 2;
static const int relayPins[NUM_RELAYS] = {26, 27, 25, 33};
static const int MQ2_PIN     = 34;

// ---------------------------
// Timing constants
// ---------------------------
static const unsigned long SENSOR_SAMPLE_INTERVAL_MS  = 300UL;
static const unsigned long BASELINE_CALIBRATION_MS    = 120000UL;
static const unsigned long SMOKE_LEARN_WINDOW_MS      = 60000UL;
static const unsigned long BASELINE_SAMPLE_MS         = 100UL;
static const unsigned long HEARTBEAT_INTERVAL_MS      = 10000UL;
static const unsigned long TELEMETRY_INTERVAL_MS      = 2000UL;
static const unsigned long MQTT_RETRY_MS              = 5000UL;
static const unsigned long WIFI_RETRY_MS              = 10000UL;
static const unsigned long AVG_PUBLISH_INTERVAL_MS    = 300000UL;

static const int MQ2_VALID_MIN = 40;
static const int MQ2_VALID_MAX = 4090;

// 5 minutes / 300 ms = 1000 samples
static const size_t AQ_WINDOW_SAMPLES = 1000;

// ---------------------------
// Runtime phase
// ---------------------------
enum RuntimePhase {
  PHASE_BOOT_CALIBRATING,
  PHASE_BOOT_SMOKE_LEARNING,
  PHASE_NORMAL
};

// ---------------------------
// App-compatible policy shape
// ---------------------------
enum FanMode {
  FAN_MODE_AUTO,
  FAN_MODE_FORCE_ON,
  FAN_MODE_FORCE_OFF,
};

struct SmokePolicy {
  FanMode       mode                  = FAN_MODE_AUTO;
  bool          safetyOverrideEnabled = true;
  int           fanRelayId            = RELAY_2_ID;
  int           smokeThresholdOn      = 0;       // 0 = dynamic threshold
  int           smokeThresholdOff     = 0;       // reserved
  int           triggerOffset         = 80;      // baseline + 80 fallback
  unsigned long minSmokeDurationMs    = 300;
  unsigned long debounceMs            = 300;
  unsigned long postSmokeCooldownMs   = 120000UL;
  float         smoothAlpha           = 0.2f;
  float         baselineAlpha         = 0.02f;
  int           timezoneOffsetMinutes = 330;
};

// ---------------------------
// Runtime state
// ---------------------------
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

WiFiClientSecure tlsClient;
PubSubClient     mqttClient(tlsClient);

SmokePolicy  smokePolicy;
RuntimePhase runtimePhase = PHASE_BOOT_CALIBRATING;

bool relayState[NUM_RELAYS] = {false, false, false, false};

int   mq2Raw            = 0;
float mq2Smoothed       = 0.0f;
float mq2Baseline       = 0.0f;
float mq2CleanBaseline  = 0.0f;
float mq2SmokeReference = 0.0f;
bool  hasSmokeReference = false;

bool          smokeActive               = false;
bool          smokeLockActive           = false;
unsigned long smokeDetectedAt           = 0;
unsigned long smokeLockUntil            = 0;
unsigned long smokeAboveSince           = 0;
float         smokeEpisodePeakIntensity = 0.0f;
String        currentEpisodeId          = "";
uint32_t      smokeEpisodeSeq           = 0;

// FIX: Fan auto-control state
// fanAutoOn          - true when the auto-logic turned relay 2 ON (so we know to turn it OFF later)
// fanManuallyDisabled - set when the user explicitly turns relay 2 OFF via app during a smoke episode;
//                       cleared when the user turns it back ON, or when the cooldown ends (for next episode)
bool fanAutoOn           = false;
bool fanManuallyDisabled = false;

unsigned long bootMs              = 0;
unsigned long lastSampleMs        = 0;
unsigned long lastTelemetryMs     = 0;
unsigned long lastHeartbeatMs     = 0;
unsigned long lastMqttReconnectMs = 0;
unsigned long lastWifiRetryMs     = 0;
unsigned long lastAvgPublishMs    = 0;
unsigned long lastValidReadingMs  = 0;  // initialized to millis() in setup()

float  aqWindow[AQ_WINDOW_SAMPLES] = {0.0f};
size_t aqWindowCount               = 0;
size_t aqWindowHead                = 0;
float  aqWindowSum                 = 0.0f;
float  aq5mLastPublished           = 0.0f;

// FIX: Global buffer for raw JSON body accumulation (POST /smoke/policy)
String smokePolicyBodyBuffer;

// ---------------------------
// Forward declarations
// ---------------------------
void addCorsHeaders(AsyncWebServerResponse *response);
void broadcastRelayUpdate(int id, bool isOn);
void broadcastHeartbeat();
void broadcastSmokeTelemetry();
void broadcastAirQualityAverage(float avg, bool ready);
void broadcastSmokeEvent(const char *eventType, unsigned long ts, bool includeDuration);
void applyRelay(int id, bool state, bool broadcast = true);
void enforceSmokeLock();
void updateSmokeDetection();
bool mqttReconnect();
void mqttCallback(char *topic, byte *payload, unsigned int length);

// ---------------------------
// Utility helpers
// ---------------------------
const char *fanModeToString(FanMode mode) {
  if (mode == FAN_MODE_FORCE_ON)  return "force_on";
  if (mode == FAN_MODE_FORCE_OFF) return "force_off";
  return "auto";
}

FanMode parseFanMode(const String &mode) {
  if (mode == "force_on")  return FAN_MODE_FORCE_ON;
  if (mode == "force_off") return FAN_MODE_FORCE_OFF;
  return FAN_MODE_AUTO;
}

const char *phaseToString(RuntimePhase phase) {
  if (phase == PHASE_BOOT_CALIBRATING)    return "boot_calibrating_clean_air";
  if (phase == PHASE_BOOT_SMOKE_LEARNING) return "boot_learning_smoke_air";
  return "normal_operation";
}

bool isSensorValueValid(int value) {
  return value >= MQ2_VALID_MIN && value <= MQ2_VALID_MAX;
}

float estimateSmokeIntensity(float smoothed, float baseline) {
  float delta = smoothed - baseline;
  if (delta <= 0.0f) return 0.0f;
  float normalized = delta / 320.0f;
  if (normalized < 0.0f) return 0.0f;
  if (normalized > 1.0f) return 1.0f;
  return normalized;
}

const char *estimateAqiBand(float intensity) {
  if (intensity < 0.15f) return "good";
  if (intensity < 0.35f) return "moderate";
  if (intensity < 0.65f) return "unhealthy";
  return "hazardous";
}

int currentThresholdOn() {
  if (smokePolicy.smokeThresholdOn > 0) return smokePolicy.smokeThresholdOn;

  int fallback = (int)mq2Baseline + smokePolicy.triggerOffset;
  if (!hasSmokeReference) return fallback;

  // Use midpoint between clean baseline and smoke reference to reduce false positives.
  if (mq2SmokeReference > (mq2Baseline + 20.0f)) {
    return (int)((mq2Baseline + mq2SmokeReference) * 0.5f);
  }

  return fallback;
}

void pushAqSample(float intensity) {
  if (aqWindowCount < AQ_WINDOW_SAMPLES) {
    aqWindow[aqWindowHead]  = intensity;
    aqWindowSum            += intensity;
    aqWindowHead            = (aqWindowHead + 1) % AQ_WINDOW_SAMPLES;
    aqWindowCount++;
    return;
  }

  aqWindowSum           -= aqWindow[aqWindowHead];
  aqWindow[aqWindowHead] = intensity;
  aqWindowSum           += intensity;
  aqWindowHead           = (aqWindowHead + 1) % AQ_WINDOW_SAMPLES;
}

float currentAq5mAverage() {
  if (aqWindowCount == 0) return 0.0f;
  return aqWindowSum / (float)aqWindowCount;
}

bool isAq5mReady() {
  return aqWindowCount >= AQ_WINDOW_SAMPLES;
}

// ---------------------------
// Relay controls
// ---------------------------
void applyRelay(int id, bool state, bool broadcast) {
  if (id < 1 || id > NUM_RELAYS) return;
  int idx = id - 1;

  relayState[idx] = state;
  digitalWrite(relayPins[idx], state ? LOW : HIGH);  // Active-LOW

  if (broadcast) {
    broadcastRelayUpdate(id, state);
  }
}

// ---------------------------
// WebSocket broadcast helpers
// ---------------------------
void broadcastRelayUpdate(int id, bool isOn) {
  StaticJsonDocument<192> doc;
  doc["type"] = "relay_update";
  JsonObject payload = doc.createNestedObject("payload");
  payload["id"]   = id;
  payload["isOn"] = isOn;

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void broadcastHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["type"] = "device_heartbeat";
  JsonObject payload = doc.createNestedObject("payload");
  payload["id"]       = "esp32-01";
  payload["online"]   = WiFi.status() == WL_CONNECTED;
  payload["rssi"]     = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127;
  payload["uptime"]   = (millis() - bootMs) / 1000;
  payload["firmware"] = "3.1.0-smoke";
  payload["ip"]       = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "0.0.0.0";

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void broadcastSmokeEvent(const char *eventType, unsigned long ts, bool includeDuration) {
  StaticJsonDocument<416> doc;
  doc["type"] = "smoke_event";
  JsonObject payload = doc.createNestedObject("payload");
  payload["eventType"]   = eventType;
  payload["eventId"]     = String("evt-") + String(ts) + "-" + eventType;
  payload["episodeId"]   = currentEpisodeId;
  payload["deviceId"]    = "esp32-01";
  payload["startedAt"]   = smokeDetectedAt;
  payload["endedAt"]     = includeDuration ? ts : 0;
  payload["durationMs"]  = includeDuration ? (ts - smokeDetectedAt) : 0;
  payload["peakIntensity"] = smokeEpisodePeakIntensity;
  payload["timestamp"]   = ts;

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void broadcastAirQualityAverage(float avg, bool ready) {
  StaticJsonDocument<224> doc;
  doc["type"] = "air_quality_average";
  JsonObject payload = doc.createNestedObject("payload");
  payload["airQualityAvg5m"]      = avg;
  payload["airQualityAvg5mReady"] = ready;
  payload["samplesInWindow"]      = aqWindowCount;
  payload["windowMs"]             = AVG_PUBLISH_INTERVAL_MS;
  payload["timestamp"]            = millis();

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void broadcastSmokeTelemetry() {
  float intensity = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);
  float avg5m     = currentAq5mAverage();
  bool  avgReady  = isAq5mReady();

  // FIX: bumped to 1024 to prevent silent truncation of ~30 fields + nested policy object
  StaticJsonDocument<1024> doc;
  doc["type"] = "smoke_telemetry";
  JsonObject payload = doc.createNestedObject("payload");
  payload["raw"]                    = mq2Raw;
  payload["smoothed"]               = mq2Smoothed;
  payload["baseline"]               = mq2Baseline;
  payload["cleanBaseline"]          = mq2CleanBaseline;
  payload["smokeReference"]         = hasSmokeReference ? mq2SmokeReference : 0;
  payload["smokeReferenceReady"]    = hasSmokeReference;
  payload["intensity"]              = intensity;
  payload["aqiBand"]                = estimateAqiBand(intensity);
  payload["smokeActive"]            = smokeActive;
  payload["fanAutoActive"]          = smokeLockActive;
  payload["cooldownRemainingMs"]    = (smokeLockActive && smokeLockUntil > millis())
                                        ? (smokeLockUntil - millis()) : 0;
  payload["airQualityAvg5m"]        = avg5m;
  payload["airQualityAvg5mReady"]   = avgReady;
  payload["air_quality_avg_5m"]     = avg5m;
  payload["air_quality_avg_5m_ready"] = avgReady;
  payload["samplesInWindow"]        = aqWindowCount;
  payload["windowMs"]               = AVG_PUBLISH_INTERVAL_MS;
  payload["phase"]                  = phaseToString(runtimePhase);
  payload["sensorHealthy"]          = millis() - lastValidReadingMs < 5000UL;
  payload["timestamp"]              = millis();

  JsonObject policy = payload.createNestedObject("policy");
  policy["mode"]                 = fanModeToString(smokePolicy.mode);
  policy["fanRelayId"]           = smokePolicy.fanRelayId;
  policy["safetyOverrideEnabled"] = smokePolicy.safetyOverrideEnabled;
  policy["smokeThresholdOn"]     = currentThresholdOn();
  policy["smokeThresholdOff"]    = smokePolicy.smokeThresholdOff;
  policy["minSmokeDurationMs"]   = smokePolicy.minSmokeDurationMs;
  policy["debounceMs"]           = smokePolicy.debounceMs;
  policy["postSmokeCooldownMs"]  = smokePolicy.postSmokeCooldownMs;
  policy["timezoneOffsetMinutes"] = smokePolicy.timezoneOffsetMinutes;

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

// ---------------------------
// Smoke automation
// ---------------------------
float sampleAverageForDuration(unsigned long durationMs, const char *label) {
  unsigned long start   = millis();
  unsigned long samples = 0;
  unsigned long sum     = 0;

  Serial.print("[SMOKE] ");
  Serial.print(label);
  Serial.print(" for ");
  Serial.print(durationMs / 1000);
  Serial.println("s...");

  while (millis() - start < durationMs) {
    int v = analogRead(MQ2_PIN);
    if (isSensorValueValid(v)) {
      sum += (unsigned long)v;
      samples++;
      lastValidReadingMs = millis();
    }
    delay(BASELINE_SAMPLE_MS);
  }

  if (samples == 0) return 2500.0f;
  return (float)sum / (float)samples;
}

void runBootCalibrationAndLearning() {
  runtimePhase      = PHASE_BOOT_CALIBRATING;
  mq2CleanBaseline  = sampleAverageForDuration(BASELINE_CALIBRATION_MS,
                        "Calibrating clean-air baseline");
  mq2Baseline       = mq2CleanBaseline;
  mq2Smoothed       = mq2Baseline;

  Serial.print("[SMOKE] Clean baseline: ");
  Serial.println(mq2CleanBaseline, 1);

  runtimePhase      = PHASE_BOOT_SMOKE_LEARNING;
  applyRelay(RELAY_2_ID, true, false);
  mq2SmokeReference = sampleAverageForDuration(SMOKE_LEARN_WINDOW_MS,
                        "Learning smoke-air profile (relay 2 ON)");
  hasSmokeReference = true;
  applyRelay(RELAY_2_ID, false, false);

  Serial.print("[SMOKE] Smoke reference: ");
  Serial.println(mq2SmokeReference, 1);
  Serial.print("[SMOKE] Dynamic threshold: ");
  Serial.println(currentThresholdOn());

  runtimePhase = PHASE_NORMAL;
}

void enforceSmokeLock() {
  if (!smokeLockActive) return;

  if (millis() >= smokeLockUntil) {
    smokeLockActive = false;
    smokeActive     = false;

    // FIX: Turn fan OFF if the auto-logic turned it ON, then reset both fan flags
    // so the next smoke episode starts fresh.
    if (fanAutoOn) {
      applyRelay(smokePolicy.fanRelayId, false, true);
      fanAutoOn = false;
      Serial.println("[SMOKE] Fan auto-OFF: cooldown complete.");
    }
    fanManuallyDisabled = false;  // allow auto-on again for the next episode

    unsigned long nowMs = millis();
    broadcastSmokeEvent("smoke_cleared", nowMs, true);
    broadcastSmokeEvent("cigarette_episode_closed", nowMs, true);
    Serial.println("[SMOKE] Safety hold complete. Relay 1 manual control restored.");
    return;
  }

  // Keep safety state deterministic while lock is active.
  applyRelay(RELAY_1_ID, false, false);
}

void updateSmokeDetection() {
  int sample = analogRead(MQ2_PIN);
  if (!isSensorValueValid(sample)) {
    return;
  }

  lastValidReadingMs = millis();
  mq2Raw             = sample;

  if (mq2Smoothed <= 0.1f) {
    mq2Smoothed = (float)mq2Raw;
  } else {
    mq2Smoothed = mq2Smoothed * (1.0f - smokePolicy.smoothAlpha)
                  + ((float)mq2Raw * smokePolicy.smoothAlpha);
  }

  // Baseline adapts only while not in smoke lock.
  if (!smokeLockActive) {
    mq2Baseline = mq2Baseline * (1.0f - smokePolicy.baselineAlpha)
                  + (mq2Smoothed * smokePolicy.baselineAlpha);
  }

  float intensity = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);
  pushAqSample(intensity);

  if (intensity > smokeEpisodePeakIntensity) {
    smokeEpisodePeakIntensity = intensity;
  }

  int  thresholdOn    = currentThresholdOn();
  bool aboveThreshold = ((int)mq2Smoothed) > thresholdOn;

  if (!smokeLockActive) {
    if (aboveThreshold) {
      if (smokeAboveSince == 0) smokeAboveSince = millis();

      if (millis() - smokeAboveSince >= smokePolicy.minSmokeDurationMs) {
        smokeActive               = true;
        smokeLockActive           = true;
        smokeDetectedAt           = millis();
        smokeLockUntil            = smokeDetectedAt + smokePolicy.postSmokeCooldownMs;
        smokeEpisodeSeq++;
        currentEpisodeId          = String("ep-") + String(smokeEpisodeSeq)
                                    + "-" + String(smokeDetectedAt);
        smokeEpisodePeakIntensity = intensity;

        // Safety: force relay 1 OFF during smoke hold.
        applyRelay(RELAY_1_ID, false, true);
        broadcastSmokeEvent("smoke_detected", smokeDetectedAt, false);
        Serial.println("[SMOKE] Detected. Relay 1 forced OFF for safety hold.");

        // FIX: Auto-turn fan (relay 2) ON, unless the user manually disabled it.
        if (!fanManuallyDisabled) {
          applyRelay(smokePolicy.fanRelayId, true, true);
          fanAutoOn = true;
          Serial.println("[SMOKE] Fan auto-ON: smoke detected.");
        } else {
          Serial.println("[SMOKE] Fan auto-ON skipped: user has manually disabled it.");
        }
      }
    } else {
      smokeAboveSince = 0;
    }
  }

  enforceSmokeLock();
}

// ---------------------------
// MQTT integration
// ---------------------------
void mqttCallback(char *topic, byte *payload, unsigned int length) {
  if (String(topic) != MQTT_TOPIC) return;

  String message;
  message.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  // MQTT kept for relay 1 compatibility.
  if (message == "1") {
    if (smokeLockActive) {
      Serial.println("[MQTT] Relay 1 ON blocked by smoke safety hold.");
      return;
    }
    applyRelay(RELAY_1_ID, true, true);
    Serial.println("[MQTT] Relay 1 ON");
  } else if (message == "0") {
    applyRelay(RELAY_1_ID, false, true);
    Serial.println("[MQTT] Relay 1 OFF");
  }
}

bool mqttReconnect() {
  static bool   lastConnected = false;
  static String clientId      = "";
  if (clientId.length() == 0) {
    uint64_t chipid = ESP.getEfuseMac();
    clientId = "ESP32_" + String((uint32_t)(chipid >> 32), HEX)
                        + String((uint32_t)chipid, HEX);
    clientId.toUpperCase();
  }

  if (WiFi.status() != WL_CONNECTED) return false;

  bool nowConnected = mqttClient.connected();
  if (nowConnected) {
    if (!lastConnected) {
      Serial.print("[MQTT] connected as ");
      Serial.println(clientId);
    }
    lastConnected = true;
    return true;
  }

  if (lastConnected) {
    Serial.print("[MQTT] disconnected, state=");
    Serial.println(mqttClient.state());
    lastConnected = false;
  }

  unsigned long nowMs = millis();
  if (nowMs - lastMqttReconnectMs < MQTT_RETRY_MS) return false;
  lastMqttReconnectMs = nowMs;

  Serial.print("[MQTT] reconnecting... ");
  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    bool subscribed = mqttClient.subscribe(MQTT_TOPIC);
    Serial.print("ok, subscribed=");
    Serial.println(subscribed ? "yes" : "no");
    lastConnected = true;
    return true;
  }

  Serial.print("failed rc=");
  Serial.println(mqttClient.state());
  lastConnected = false;
  return false;
}

// ---------------------------
// HTTP + WS handlers
// ---------------------------
void addCorsHeaders(AsyncWebServerResponse *response) {
  response->addHeader("Access-Control-Allow-Origin",  "*");
  response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response->addHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleCors(AsyncWebServerRequest *request) {
  AsyncWebServerResponse *response = request->beginResponse(204);
  addCorsHeaders(response);
  request->send(response);
}

void handleRelayStatus(AsyncWebServerRequest *request) {
  StaticJsonDocument<256> doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < NUM_RELAYS; i++) {
    JsonObject r = arr.createNestedObject();
    r["id"]   = i + 1;
    r["isOn"] = relayState[i];
  }

  String json;
  serializeJson(doc, json);

  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleRelayToggle(AsyncWebServerRequest *request) {
  if (!request->hasParam("id") || !request->hasParam("state")) {
    request->send(400, "text/plain", "Missing parameters");
    return;
  }

  int    id       = request->getParam("id")->value().toInt();
  String stateArg = request->getParam("state")->value();
  bool   state    = stateArg == "1";

  if (id < 1 || id > NUM_RELAYS || (stateArg != "1" && stateArg != "0")) {
    request->send(400, "text/plain", "Invalid id or state");
    return;
  }

  if (smokeLockActive && id == RELAY_1_ID && state) {
    StaticJsonDocument<192> doc;
    doc["error"]        = "Relay 1 locked OFF due to smoke safety hold";
    doc["retryAfterMs"] = smokeLockUntil > millis() ? (smokeLockUntil - millis()) : 0;

    String json;
    serializeJson(doc, json);

    AsyncWebServerResponse *response = request->beginResponse(423, "application/json", json);
    addCorsHeaders(response);
    request->send(response);
    return;
  }

  // FIX: Track manual fan override so auto-logic respects user intent.
  if (id == smokePolicy.fanRelayId) {
    if (!state) {
      fanManuallyDisabled = true;
      fanAutoOn           = false;  // user took over; don't auto-OFF at cooldown end
      Serial.println("[FAN] Manually disabled by user via HTTP.");
    } else {
      fanManuallyDisabled = false;
      Serial.println("[FAN] Manually enabled by user via HTTP.");
    }
  }

  applyRelay(id, state, true);

  StaticJsonDocument<96> doc;
  doc["id"]   = id;
  doc["isOn"] = state;

  String json;
  serializeJson(doc, json);

  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleSmokeStatus(AsyncWebServerRequest *request) {
  float intensity = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);
  float avg5m     = currentAq5mAverage();
  bool  avgReady  = isAq5mReady();

  // FIX: bumped to 1024 to prevent silent truncation
  StaticJsonDocument<1024> doc;

  JsonObject telemetry = doc.createNestedObject("telemetry");
  telemetry["raw"]                      = mq2Raw;
  telemetry["smoothed"]                 = mq2Smoothed;
  telemetry["baseline"]                 = mq2Baseline;
  telemetry["cleanBaseline"]            = mq2CleanBaseline;
  telemetry["smokeReference"]           = hasSmokeReference ? mq2SmokeReference : 0;
  telemetry["smokeReferenceReady"]      = hasSmokeReference;
  telemetry["intensity"]                = intensity;
  telemetry["aqiBand"]                  = estimateAqiBand(intensity);
  telemetry["smokeActive"]              = smokeActive;
  telemetry["fanAutoActive"]            = smokeLockActive;
  telemetry["cooldownRemainingMs"]      = (smokeLockActive && smokeLockUntil > millis())
                                            ? (smokeLockUntil - millis()) : 0;
  telemetry["airQualityAvg5m"]          = avg5m;
  telemetry["airQualityAvg5mReady"]     = avgReady;
  telemetry["air_quality_avg_5m"]       = avg5m;
  telemetry["air_quality_avg_5m_ready"] = avgReady;
  telemetry["samplesInWindow"]          = aqWindowCount;
  telemetry["windowMs"]                 = AVG_PUBLISH_INTERVAL_MS;
  telemetry["phase"]                    = phaseToString(runtimePhase);
  telemetry["sensorHealthy"]            = millis() - lastValidReadingMs < 5000UL;
  telemetry["timestamp"]                = millis();

  JsonObject policy = doc.createNestedObject("policy");
  policy["mode"]                  = fanModeToString(smokePolicy.mode);
  policy["fanRelayId"]            = smokePolicy.fanRelayId;
  policy["safetyOverrideEnabled"] = smokePolicy.safetyOverrideEnabled;
  policy["smokeThresholdOn"]      = currentThresholdOn();
  policy["smokeThresholdOff"]     = smokePolicy.smokeThresholdOff;
  policy["minSmokeDurationMs"]    = smokePolicy.minSmokeDurationMs;
  policy["debounceMs"]            = smokePolicy.debounceMs;
  policy["postSmokeCooldownMs"]   = smokePolicy.postSmokeCooldownMs;
  policy["timezoneOffsetMinutes"] = smokePolicy.timezoneOffsetMinutes;

  doc["cigarettesToday"] = 0;
  JsonObject syncStatus  = doc.createNestedObject("syncStatus");
  syncStatus["pending"]  = 0;
  syncStatus["failed"]   = 0;
  syncStatus["synced"]   = true;

  String json;
  serializeJson(doc, json);

  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

// FIX: Body data handler for POST /smoke/policy.
// ESPAsyncWebServer does NOT populate request->getParam("plain") for raw JSON bodies
// (Content-Type: application/json). We must use the onBody callback (3-arg server.on).
// The body is accumulated in a global buffer across chunks, then parsed when complete.
void handleSmokePolicyBody(AsyncWebServerRequest *request,
                           uint8_t *data, size_t len,
                           size_t index, size_t total) {
  if (index == 0) {
    smokePolicyBodyBuffer = "";
    smokePolicyBodyBuffer.reserve(total);
  }

  for (size_t i = 0; i < len; i++) {
    smokePolicyBodyBuffer += (char)data[i];
  }

  // Wait until all chunks have arrived before parsing.
  if (index + len < total) return;

  StaticJsonDocument<384> doc;
  DeserializationError err = deserializeJson(doc, smokePolicyBodyBuffer);
  if (err) {
    AsyncWebServerResponse *resp = request->beginResponse(400, "text/plain", "Invalid JSON body");
    addCorsHeaders(resp);
    request->send(resp);
    return;
  }

  // FIX: Use !isNull() + .as<>() instead of .is<unsigned long>() which silently fails
  // in ArduinoJson v6 (integers are stored internally as long long).
  if (!doc["mode"].isNull())
    smokePolicy.mode = parseFanMode(doc["mode"].as<String>());
  if (!doc["fanRelayId"].isNull())
    smokePolicy.fanRelayId = doc["fanRelayId"].as<int>();
  if (!doc["safetyOverrideEnabled"].isNull())
    smokePolicy.safetyOverrideEnabled = doc["safetyOverrideEnabled"].as<bool>();
  if (!doc["smokeThresholdOn"].isNull())
    smokePolicy.smokeThresholdOn = doc["smokeThresholdOn"].as<int>();
  if (!doc["smokeThresholdOff"].isNull())
    smokePolicy.smokeThresholdOff = doc["smokeThresholdOff"].as<int>();
  if (!doc["minSmokeDurationMs"].isNull())  // FIX: was is<unsigned long>() — never true in v6
    smokePolicy.minSmokeDurationMs = doc["minSmokeDurationMs"].as<unsigned long>();
  if (!doc["debounceMs"].isNull())          // FIX: same
    smokePolicy.debounceMs = doc["debounceMs"].as<unsigned long>();
  if (!doc["postSmokeCooldownMs"].isNull()) // FIX: same
    smokePolicy.postSmokeCooldownMs = doc["postSmokeCooldownMs"].as<unsigned long>();
  if (!doc["timezoneOffsetMinutes"].isNull())
    smokePolicy.timezoneOffsetMinutes = doc["timezoneOffsetMinutes"].as<int>();
  if (!doc["triggerOffset"].isNull())
    smokePolicy.triggerOffset = doc["triggerOffset"].as<int>();

  StaticJsonDocument<384> out;
  out["mode"]                  = fanModeToString(smokePolicy.mode);
  out["fanRelayId"]            = smokePolicy.fanRelayId;
  out["safetyOverrideEnabled"] = smokePolicy.safetyOverrideEnabled;
  out["smokeThresholdOn"]      = currentThresholdOn();
  out["smokeThresholdOff"]     = smokePolicy.smokeThresholdOff;
  out["minSmokeDurationMs"]    = smokePolicy.minSmokeDurationMs;
  out["debounceMs"]            = smokePolicy.debounceMs;
  out["postSmokeCooldownMs"]   = smokePolicy.postSmokeCooldownMs;
  out["timezoneOffsetMinutes"] = smokePolicy.timezoneOffsetMinutes;

  String json;
  serializeJson(out, json);

  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleHealth(AsyncWebServerRequest *request) {
  StaticJsonDocument<288> doc;
  doc["status"]              = "OK";
  doc["wifi"]                = WiFi.status() == WL_CONNECTED;
  doc["mqtt"]                = mqttClient.connected();
  doc["mqttState"]           = mqttClient.state();
  doc["uptimeSec"]           = (millis() - bootMs) / 1000;
  doc["phase"]               = phaseToString(runtimePhase);
  doc["airQualityAvg5mReady"] = isAq5mReady();

  String json;
  serializeJson(doc, json);

  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void onWsEvent(AsyncWebSocket *serverPtr, AsyncWebSocketClient *client, AwsEventType type,
               void *arg, uint8_t *data, size_t len) {
  (void)serverPtr;

  if (type == WS_EVT_CONNECT) {
    StaticJsonDocument<288> doc;
    doc["type"] = "initial_state";
    JsonObject payload = doc.createNestedObject("payload");
    JsonArray  relays  = payload.createNestedArray("relays");
    for (int i = 0; i < NUM_RELAYS; i++) {
      JsonObject r = relays.createNestedObject();
      r["id"]   = i + 1;
      r["isOn"] = relayState[i];
    }

    String json;
    serializeJson(doc, json);
    client->text(json);
    return;
  }

  if (type != WS_EVT_DATA) return;

  AwsFrameInfo *info = (AwsFrameInfo *)arg;
  if (!info->final || info->index != 0 || info->opcode != WS_TEXT) return;

  String msg;
  msg.reserve(len + 1);
  for (size_t i = 0; i < len; i++) {
    msg += (char)data[i];
  }

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, msg)) return;

  const char *msgType = doc["type"] | "";
  if (strcmp(msgType, "ping") == 0) {
    client->text("{\"type\":\"pong\",\"payload\":{}}");
    return;
  }

  if (strcmp(msgType, "toggle") == 0) {
    int  id   = doc["payload"]["id"]   | 0;
    bool isOn = doc["payload"]["isOn"] | false;

    if (id < 1 || id > NUM_RELAYS) return;
    if (smokeLockActive && id == RELAY_1_ID && isOn) return;

    // FIX: Track manual fan override from WebSocket as well.
    if (id == smokePolicy.fanRelayId) {
      if (!isOn) {
        fanManuallyDisabled = true;
        fanAutoOn           = false;
        Serial.println("[FAN] Manually disabled by user via WS.");
      } else {
        fanManuallyDisabled = false;
        Serial.println("[FAN] Manually enabled by user via WS.");
      }
    }

    applyRelay(id, isOn, true);
  }
}

// ---------------------------
// Lifecycle
// ---------------------------
void setup() {
  Serial.begin(115200);
  bootMs = millis();

  // FIX: Initialize lastValidReadingMs to now so sensorHealthy doesn't
  // flicker false during the 2-minute boot calibration window.
  lastValidReadingMs = millis();

  for (int i = 0; i < NUM_RELAYS; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH);  // Active-LOW OFF
  }

  pinMode(MQ2_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(MQ2_PIN, ADC_11db);

  WiFi.begin(ssid, password);
  Serial.print("[WiFi] Connecting");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 30000UL) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected IP: ");
    Serial.println(WiFi.localIP());

    if (MDNS.begin(hostname)) {
      MDNS.addService("http", "tcp", 80);
      MDNS.addService("ws",   "tcp", 80);
      Serial.print("[mDNS] http://");
      Serial.print(hostname);
      Serial.println(".local");
    }
  } else {
    Serial.println("[WiFi] Not connected at boot. Will retry in loop.");
  }

  runBootCalibrationAndLearning();
  lastAvgPublishMs = millis();

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  server.on("/relays/status", HTTP_GET,     handleRelayStatus);
  server.on("/relays/toggle", HTTP_POST,    handleRelayToggle);
  server.on("/relays/toggle", HTTP_OPTIONS, handleCors);
  server.on("/smoke/status",  HTTP_GET,     handleSmokeStatus);

  // FIX: Use the 5-arg overload so ESPAsyncWebServer delivers the raw JSON body
  // via the body-data callback instead of the broken "plain" param approach.
  server.on("/smoke/policy", HTTP_POST,
    [](AsyncWebServerRequest *request) {},  // request handler (intentionally empty)
    nullptr,                                 // file upload handler (unused)
    handleSmokePolicyBody                    // body data handler
  );
  server.on("/smoke/policy", HTTP_OPTIONS, handleCors);

  server.on("/health", HTTP_GET, handleHealth);
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    AsyncWebServerResponse *response =
      request->beginResponse(200, "text/plain", "ESP32 relay controller online");
    addCorsHeaders(response);
    request->send(response);
  });

  server.begin();
  Serial.println("[HTTP] Server started on port 80");

  mqttClient.setKeepAlive(60);
  mqttClient.setSocketTimeout(5);
  mqttClient.setBufferSize(512);
  tlsClient.setInsecure();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttReconnect();
}

void loop() {
  unsigned long nowMs = millis();

  ws.cleanupClients();

  if (WiFi.status() != WL_CONNECTED && nowMs - lastWifiRetryMs >= WIFI_RETRY_MS) {
    lastWifiRetryMs = nowMs;
    WiFi.disconnect();
    WiFi.begin(ssid, password);
  }

  mqttReconnect();
  mqttClient.loop();

  if (nowMs - lastSampleMs >= SENSOR_SAMPLE_INTERVAL_MS) {
    lastSampleMs = nowMs;
    updateSmokeDetection();
  }

  if (nowMs - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = nowMs;
    broadcastSmokeTelemetry();
  }

  if (nowMs - lastAvgPublishMs >= AVG_PUBLISH_INTERVAL_MS) {
    lastAvgPublishMs    = nowMs;
    aq5mLastPublished   = currentAq5mAverage();
    broadcastAirQualityAverage(aq5mLastPublished, isAq5mReady());
  }

  if (nowMs - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = nowMs;
    broadcastHeartbeat();
  }
}
