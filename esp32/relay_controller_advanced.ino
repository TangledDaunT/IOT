/**
 * ESP32 Advanced Relay Controller
 * 
 * Features:
 *   - mDNS: Access via http://esp32.local
 *   - WebSocket: Real-time push updates to clients
 *   - LittleFS: Serve React dashboard directly from ESP32
 *   - CORS: Full cross-origin support for development
 * 
 * Endpoints:
 *   GET  /                           → Serves index.html from LittleFS
 *   GET  /relays/status              → [{ id, isOn }, ...]
 *   POST /relays/toggle?id=X&state=1|0 → { id, isOn }
 *   GET  /smoke/status               → smoke telemetry + automation policy
 *   POST /smoke/policy               → update smoke automation policy
 *   GET  /health                     → "OK"
 *   WS   /ws                         → WebSocket for real-time updates
 * 
 * Libraries Required (install via Arduino Library Manager):
 *   - ESPAsyncWebServer (by me-no-dev)
 *   - AsyncTCP (by me-no-dev)
 *   - ArduinoJson (by Benoit Blanchon)
 * 
 * Upload LittleFS data:
 *   Use ESP32 Sketch Data Upload tool or the Python script
 *   provided in esp32/upload_littlefs.py
 * 
 * GPIO Pin Mapping (active-LOW relays):
 *   - Relay 1: GPIO 5
 *   - Relay 2: GPIO 18
 *   - Relay 3: GPIO 19
 *   - Relay 4: GPIO 21
 */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────
const char* ssid       = "YOUR_WIFI_NAME";
const char* password   = "YOUR_WIFI_PASSWORD";
const char* hostname   = "esp32";  // Access via http://esp32.local

// ─────────────────────────────────────────────────────────────
// GPIO PIN MAPPING
// ─────────────────────────────────────────────────────────────
#define RELAY1 5
#define RELAY2 18
#define RELAY3 19
#define RELAY4 21
#define MQ2_PIN 34

#define NUM_RELAYS 4

// Relay state tracking
bool relayState[NUM_RELAYS] = {false, false, false, false};
const int relayPins[NUM_RELAYS] = {RELAY1, RELAY2, RELAY3, RELAY4};

// Server instances
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// Uptime tracking
unsigned long bootTime = 0;

// ─────────────────────────────────────────────────────────────
// SMOKE DETECTION + FAN AUTOMATION
// ─────────────────────────────────────────────────────────────
enum FanMode {
  FAN_MODE_AUTO,
  FAN_MODE_FORCE_ON,
  FAN_MODE_FORCE_OFF,
};

struct SmokePolicy {
  FanMode mode = FAN_MODE_AUTO;
  bool safetyOverrideEnabled = false;
  int fanRelayId = 2;
  int smokeThresholdOn = 260;
  int smokeThresholdOff = 200;
  unsigned long minSmokeDurationMs = 6000;
  unsigned long debounceMs = 1800;
  unsigned long postSmokeCooldownMs = 120000;
  float smoothAlpha = 0.2;
  float baselineAlpha = 0.02;
};

SmokePolicy smokePolicy;

int mq2Raw = 0;
float mq2Smoothed = 0;
float mq2Baseline = 0;
bool smokeActive = false;
bool fanAutoActive = false;
unsigned long smokeAboveSince = 0;
unsigned long smokeBelowSince = 0;
unsigned long smokeCooldownUntil = 0;
unsigned long smokeEpisodeStart = 0;
float smokeEpisodePeakIntensity = 0;
uint32_t smokeEpisodeSeq = 0;

unsigned long lastSmokeSampleAt = 0;
unsigned long lastSmokeTelemetryAt = 0;

const unsigned long SMOKE_SAMPLE_INTERVAL_MS = 250;
const unsigned long SMOKE_TELEMETRY_INTERVAL_MS = 2000;

String currentEpisodeId = "";

// ─────────────────────────────────────────────────────────────
// RELAY CONTROL
// ─────────────────────────────────────────────────────────────
void applyRelay(int id, bool state, bool broadcast = true) {
  if (id < 1 || id > NUM_RELAYS) return;
  
  int idx = id - 1;
  if (relayState[idx] == state) return;
  relayState[idx] = state;
  
  // Active-LOW: LOW = ON, HIGH = OFF
  digitalWrite(relayPins[idx], state ? LOW : HIGH);
  
  Serial.printf("Relay %d → %s\n", id, state ? "ON" : "OFF");
  
  // Broadcast state change to all WebSocket clients
  if (broadcast) {
    broadcastRelayUpdate(id, state);
  }
}

// ─────────────────────────────────────────────────────────────
// WEBSOCKET HANDLERS
// ─────────────────────────────────────────────────────────────
void broadcastRelayUpdate(int id, bool isOn) {
  JsonDocument doc;
  doc["type"] = "relay_update";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["id"] = id;
  payload["isOn"] = isOn;
  
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

const char* fanModeToString(FanMode mode) {
  if (mode == FAN_MODE_FORCE_ON) return "force_on";
  if (mode == FAN_MODE_FORCE_OFF) return "force_off";
  return "auto";
}

FanMode parseFanMode(const String &mode) {
  if (mode == "force_on") return FAN_MODE_FORCE_ON;
  if (mode == "force_off") return FAN_MODE_FORCE_OFF;
  return FAN_MODE_AUTO;
}

float estimateSmokeIntensity(float smoothed, float baseline) {
  float delta = smoothed - baseline;
  if (delta <= 0) return 0.0f;
  float norm = delta / 320.0f;
  if (norm < 0.0f) return 0.0f;
  if (norm > 1.0f) return 1.0f;
  return norm;
}

const char* estimateAqiBand(float intensity) {
  if (intensity < 0.15f) return "good";
  if (intensity < 0.35f) return "moderate";
  if (intensity < 0.65f) return "unhealthy";
  return "hazardous";
}

void broadcastSmokeEvent(const char* eventType, unsigned long ts) {
  JsonDocument doc;
  doc["type"] = "smoke_event";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["eventType"] = eventType;
  payload["eventId"] = String("evt-") + String(ts) + String("-") + eventType;
  payload["episodeId"] = currentEpisodeId;
  payload["deviceId"] = hostname;
  payload["startedAt"] = smokeEpisodeStart;
  payload["endedAt"] = smokeActive ? 0 : ts;
  payload["durationMs"] = smokeEpisodeStart > 0 ? (ts - smokeEpisodeStart) : 0;
  payload["peakIntensity"] = smokeEpisodePeakIntensity;
  payload["timestamp"] = ts;

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void broadcastSmokeTelemetry() {
  float intensity = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);
  JsonDocument doc;
  doc["type"] = "smoke_telemetry";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["raw"] = mq2Raw;
  payload["smoothed"] = mq2Smoothed;
  payload["baseline"] = mq2Baseline;
  payload["intensity"] = intensity;
  payload["aqiBand"] = estimateAqiBand(intensity);
  payload["smokeActive"] = smokeActive;
  payload["fanAutoActive"] = fanAutoActive;
  payload["cooldownRemainingMs"] = smokeCooldownUntil > millis() ? (smokeCooldownUntil - millis()) : 0;
  JsonObject policy = payload["policy"].to<JsonObject>();
  policy["mode"] = fanModeToString(smokePolicy.mode);
  policy["fanRelayId"] = smokePolicy.fanRelayId;
  policy["safetyOverrideEnabled"] = smokePolicy.safetyOverrideEnabled;
  payload["timestamp"] = millis();

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void emitFanAutoChange(bool enabled) {
  JsonDocument doc;
  unsigned long ts = millis();
  doc["type"] = "smoke_event";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["eventType"] = enabled ? "fan_auto_on" : "fan_auto_off";
  payload["eventId"] = String("evt-") + String(ts) + String(enabled ? "-fan-on" : "-fan-off");
  payload["episodeId"] = currentEpisodeId;
  payload["deviceId"] = hostname;
  payload["timestamp"] = ts;

  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void applyFanAutomation(unsigned long nowMs) {
  bool desiredAutoOn = false;
  float intensity = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);

  if (smokePolicy.mode == FAN_MODE_FORCE_ON) {
    desiredAutoOn = true;
  } else if (smokePolicy.mode == FAN_MODE_FORCE_OFF) {
    desiredAutoOn = smokePolicy.safetyOverrideEnabled && intensity >= 0.8f;
  } else {
    desiredAutoOn = smokeActive || nowMs < smokeCooldownUntil;
  }

  if (fanAutoActive != desiredAutoOn) {
    fanAutoActive = desiredAutoOn;
    emitFanAutoChange(fanAutoActive);
  }

  applyRelay(smokePolicy.fanRelayId, desiredAutoOn, true);
}

void updateSmokeDetection() {
  unsigned long nowMs = millis();
  mq2Raw = analogRead(MQ2_PIN);

  if (mq2Smoothed <= 0.1f) {
    mq2Smoothed = (float)mq2Raw;
  } else {
    mq2Smoothed = (mq2Smoothed * (1.0f - smokePolicy.smoothAlpha)) + ((float)mq2Raw * smokePolicy.smoothAlpha);
  }

  if (!smokeActive) {
    if (mq2Baseline <= 0.1f) mq2Baseline = mq2Smoothed;
    mq2Baseline = (mq2Baseline * (1.0f - smokePolicy.baselineAlpha)) + (mq2Smoothed * smokePolicy.baselineAlpha);
  }

  float intensity = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);
  if (intensity > smokeEpisodePeakIntensity) smokeEpisodePeakIntensity = intensity;

  if (mq2Smoothed >= smokePolicy.smokeThresholdOn) {
    if (smokeAboveSince == 0) smokeAboveSince = nowMs;
    if (!smokeActive && (nowMs - smokeAboveSince) >= smokePolicy.minSmokeDurationMs) {
      smokeActive = true;
      smokeBelowSince = 0;
      smokeEpisodeStart = nowMs;
      smokeEpisodePeakIntensity = intensity;
      smokeEpisodeSeq++;
      currentEpisodeId = String("ep-") + String(smokeEpisodeSeq) + String("-") + String(nowMs);
      broadcastSmokeEvent("smoke_detected", nowMs);
    }
  } else {
    smokeAboveSince = 0;
  }

  if (smokeActive) {
    if (mq2Smoothed <= smokePolicy.smokeThresholdOff) {
      if (smokeBelowSince == 0) smokeBelowSince = nowMs;
      if ((nowMs - smokeBelowSince) >= smokePolicy.debounceMs) {
        smokeActive = false;
        smokeCooldownUntil = nowMs + smokePolicy.postSmokeCooldownMs;
        broadcastSmokeEvent("smoke_cleared", nowMs);
        broadcastSmokeEvent("cigarette_episode_closed", nowMs);
      }
    } else {
      smokeBelowSince = 0;
    }
  }

  applyFanAutomation(nowMs);
}

void broadcastHeartbeat() {
  JsonDocument doc;
  doc["type"] = "device_heartbeat";
  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["id"] = hostname;
  payload["online"] = true;
  payload["rssi"] = WiFi.RSSI();
  payload["uptime"] = (millis() - bootTime) / 1000;
  payload["firmware"] = "1.0.0";
  payload["ip"] = WiFi.localIP().toString();
  
  String json;
  serializeJson(doc, json);
  ws.textAll(json);
}

void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, 
               AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("WebSocket client #%u connected from %s\n", 
                    client->id(), client->remoteIP().toString().c_str());
      // Send current state to newly connected client
      {
        JsonDocument doc;
        doc["type"] = "initial_state";
        JsonArray relays = doc["payload"]["relays"].to<JsonArray>();
        for (int i = 0; i < NUM_RELAYS; i++) {
          JsonObject r = relays.add<JsonObject>();
          r["id"] = i + 1;
          r["isOn"] = relayState[i];
        }
        String json;
        serializeJson(doc, json);
        client->text(json);
      }
      break;
      
    case WS_EVT_DISCONNECT:
      Serial.printf("WebSocket client #%u disconnected\n", client->id());
      break;
      
    case WS_EVT_DATA:
      // Handle incoming WebSocket messages
      {
        AwsFrameInfo *info = (AwsFrameInfo*)arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
          data[len] = 0;  // Null terminate
          String msg = (char*)data;
          
          JsonDocument doc;
          DeserializationError err = deserializeJson(doc, msg);
          if (!err) {
            const char* type = doc["type"];
            if (strcmp(type, "ping") == 0) {
              // Respond with pong
              client->text("{\"type\":\"pong\"}");
            } else if (strcmp(type, "toggle") == 0) {
              // Handle toggle command via WebSocket
              int id = doc["payload"]["id"];
              bool state = doc["payload"]["isOn"];
              applyRelay(id, state);
            }
          }
        }
      }
      break;
      
    case WS_EVT_PONG:
    case WS_EVT_ERROR:
      break;
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP HANDLERS
// ─────────────────────────────────────────────────────────────
void addCorsHeaders(AsyncWebServerResponse *response) {
  response->addHeader("Access-Control-Allow-Origin", "*");
  response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response->addHeader("Access-Control-Allow-Headers", "Content-Type");
}

void handleStatus(AsyncWebServerRequest *request) {
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  
  for (int i = 0; i < NUM_RELAYS; i++) {
    JsonObject relay = arr.add<JsonObject>();
    relay["id"] = i + 1;
    relay["isOn"] = relayState[i];
  }
  
  String json;
  serializeJson(doc, json);
  
  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleToggle(AsyncWebServerRequest *request) {
  if (!request->hasParam("id") || !request->hasParam("state")) {
    request->send(400, "text/plain", "Missing parameters");
    return;
  }
  
  int id = request->getParam("id")->value().toInt();
  bool state = request->getParam("state")->value() == "1";
  
  applyRelay(id, state);
  
  JsonDocument doc;
  doc["id"] = id;
  doc["isOn"] = state;
  
  String json;
  serializeJson(doc, json);
  
  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleHealth(AsyncWebServerRequest *request) {
  AsyncWebServerResponse *response = request->beginResponse(200, "text/plain", "OK");
  addCorsHeaders(response);
  request->send(response);
}

void handleSmokeStatus(AsyncWebServerRequest *request) {
  JsonDocument doc;

  JsonObject telemetry = doc["telemetry"].to<JsonObject>();
  telemetry["raw"] = mq2Raw;
  telemetry["smoothed"] = mq2Smoothed;
  telemetry["baseline"] = mq2Baseline;
  telemetry["intensity"] = estimateSmokeIntensity(mq2Smoothed, mq2Baseline);
  telemetry["aqiBand"] = estimateAqiBand(estimateSmokeIntensity(mq2Smoothed, mq2Baseline));
  telemetry["smokeActive"] = smokeActive;
  telemetry["fanAutoActive"] = fanAutoActive;
  telemetry["cooldownRemainingMs"] = smokeCooldownUntil > millis() ? (smokeCooldownUntil - millis()) : 0;
  telemetry["timestamp"] = millis();

  JsonObject policy = doc["policy"].to<JsonObject>();
  policy["mode"] = fanModeToString(smokePolicy.mode);
  policy["fanRelayId"] = smokePolicy.fanRelayId;
  policy["safetyOverrideEnabled"] = smokePolicy.safetyOverrideEnabled;
  policy["smokeThresholdOn"] = smokePolicy.smokeThresholdOn;
  policy["smokeThresholdOff"] = smokePolicy.smokeThresholdOff;
  policy["minSmokeDurationMs"] = smokePolicy.minSmokeDurationMs;
  policy["debounceMs"] = smokePolicy.debounceMs;
  policy["postSmokeCooldownMs"] = smokePolicy.postSmokeCooldownMs;

  doc["syncStatus"]["pending"] = 0;
  doc["syncStatus"]["failed"] = 0;
  doc["syncStatus"]["synced"] = true;

  String json;
  serializeJson(doc, json);
  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleSmokePolicy(AsyncWebServerRequest *request) {
  if (!request->hasParam("plain", true)) {
    request->send(400, "text/plain", "Missing JSON body");
    return;
  }

  String body = request->getParam("plain", true)->value();
  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    request->send(400, "text/plain", "Invalid JSON body");
    return;
  }

  if (doc["mode"].is<const char*>()) smokePolicy.mode = parseFanMode(String((const char*)doc["mode"]));
  if (doc["fanRelayId"].is<int>()) smokePolicy.fanRelayId = doc["fanRelayId"];
  if (doc["safetyOverrideEnabled"].is<bool>()) smokePolicy.safetyOverrideEnabled = doc["safetyOverrideEnabled"];
  if (doc["smokeThresholdOn"].is<int>()) smokePolicy.smokeThresholdOn = doc["smokeThresholdOn"];
  if (doc["smokeThresholdOff"].is<int>()) smokePolicy.smokeThresholdOff = doc["smokeThresholdOff"];
  if (doc["minSmokeDurationMs"].is<unsigned long>()) smokePolicy.minSmokeDurationMs = doc["minSmokeDurationMs"];
  if (doc["debounceMs"].is<unsigned long>()) smokePolicy.debounceMs = doc["debounceMs"];
  if (doc["postSmokeCooldownMs"].is<unsigned long>()) smokePolicy.postSmokeCooldownMs = doc["postSmokeCooldownMs"];

  JsonDocument out;
  out["mode"] = fanModeToString(smokePolicy.mode);
  out["fanRelayId"] = smokePolicy.fanRelayId;
  out["safetyOverrideEnabled"] = smokePolicy.safetyOverrideEnabled;
  out["smokeThresholdOn"] = smokePolicy.smokeThresholdOn;
  out["smokeThresholdOff"] = smokePolicy.smokeThresholdOff;
  out["minSmokeDurationMs"] = smokePolicy.minSmokeDurationMs;
  out["debounceMs"] = smokePolicy.debounceMs;
  out["postSmokeCooldownMs"] = smokePolicy.postSmokeCooldownMs;

  String json;
  serializeJson(out, json);

  AsyncWebServerResponse *response = request->beginResponse(200, "application/json", json);
  addCorsHeaders(response);
  request->send(response);
}

void handleCors(AsyncWebServerRequest *request) {
  AsyncWebServerResponse *response = request->beginResponse(204);
  addCorsHeaders(response);
  request->send(response);
}

void sendDashboardIndex(AsyncWebServerRequest *request) {
  if (LittleFS.exists("/index.html")) {
    request->send(LittleFS, "/index.html", "text/html");
    return;
  }

  if (LittleFS.exists("/index.html.gz")) {
    AsyncWebServerResponse *response = request->beginResponse(LittleFS, "/index.html.gz", "text/html");
    response->addHeader("Content-Encoding", "gzip");
    request->send(response);
    return;
  }

  request->send(500, "text/plain", "Dashboard files missing in LittleFS");
}

// ─────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  bootTime = millis();
  
  // Initialize relay pins
  for (int i = 0; i < NUM_RELAYS; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], HIGH);  // Active-LOW: HIGH = OFF
  }

  pinMode(MQ2_PIN, INPUT);
  
  // Initialize LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed!");
  } else {
    Serial.println("LittleFS mounted");
    // List files for debugging
    File root = LittleFS.open("/");
    File file = root.openNextFile();
    while (file) {
      Serial.printf("  File: %s (%d bytes)\n", file.name(), file.size());
      file = root.openNextFile();
    }
  }
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.printf("Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  
  // Setup mDNS
  if (MDNS.begin(hostname)) {
    Serial.printf("mDNS started: http://%s.local\n", hostname);
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("ws", "tcp", 80);
  } else {
    Serial.println("mDNS failed to start");
  }
  
  // Setup WebSocket
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  
  // API routes
  server.on("/relays/status", HTTP_GET, handleStatus);
  server.on("/relays/toggle", HTTP_POST, handleToggle);
  server.on("/relays/toggle", HTTP_OPTIONS, handleCors);
  server.on("/smoke/status", HTTP_GET, handleSmokeStatus);
  server.on("/smoke/policy", HTTP_POST, handleSmokePolicy);
  server.on("/smoke/policy", HTTP_OPTIONS, handleCors);
  server.on("/health", HTTP_GET, handleHealth);
  server.on("/", HTTP_GET, sendDashboardIndex);
  server.on("/index.html", HTTP_GET, sendDashboardIndex);
  
  // Serve static files from LittleFS (React build)
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");
  
  // Handle 404 - try to serve index.html for SPA routing
  server.onNotFound([](AsyncWebServerRequest *request) {
    // For API routes, return 404
    if (
      request->url().startsWith("/relays") ||
      request->url().startsWith("/health") ||
      request->url().startsWith("/smoke") ||
      request->url().startsWith("/ws")
    ) {
      request->send(404, "text/plain", "Not found");
      return;
    }
    // For other routes, serve index.html (SPA client-side routing)
    sendDashboardIndex(request);
  });
  
  server.begin();
  Serial.println("HTTP server started");
  Serial.println("────────────────────────────────────");
  Serial.printf("Dashboard: http://%s.local\n", hostname);
  Serial.printf("Dashboard: http://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("────────────────────────────────────");
}

// ─────────────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────────────
unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 10000;  // 10 seconds

void loop() {
  // Cleanup disconnected WebSocket clients
  ws.cleanupClients();
  
  // Send periodic heartbeat
  if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
    lastHeartbeat = millis();
    broadcastHeartbeat();
  }

  if (millis() - lastSmokeSampleAt >= SMOKE_SAMPLE_INTERVAL_MS) {
    lastSmokeSampleAt = millis();
    updateSmokeDetection();
  }

  if (millis() - lastSmokeTelemetryAt >= SMOKE_TELEMETRY_INTERVAL_MS) {
    lastSmokeTelemetryAt = millis();
    broadcastSmokeTelemetry();
  }
}
