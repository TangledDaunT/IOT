/**
 * ESP32 Relay Controller
 * 
 * Controls 4 relays via HTTP endpoints for integration with the
 * IoT Control Dashboard React app. Also subscribes to HiveMQ Cloud
 * via MQTT over TLS (port 8883) to allow remote relay control.
 * 
 * Endpoints:
 *   GET  /relays/status      → [{ id, isOn }, ...]
 *   POST /relays/toggle?id=X&state=1|0 → { id, isOn }
 *   GET  /health             → "OK"
 * 
 * MQTT:
 *   Broker : HiveMQ Cloud (TLS, port 8883)
 *   Topic  : Shreyansh/feeds/room-relay
 *   Payload: "1" → Relay 1 ON  |  "0" → Relay 1 OFF
 * 
 * Wiring (active-LOW relays):
 *   - Relay 1: GPIO 
 *   - Relay 2: GPIO 18
 *   - Relay 3: GPIO 19
 *   - Relay 4: GPIO 21
 * 
 * Setup:
 *   1. Update ssid, password, MQTT_USER, and MQTT_PASS below
 *   2. Upload to ESP32 via Arduino IDE
 *   3. Open Serial Monitor (115200 baud) to see IP address
 *   4. Enter IP address in the React app Settings page
 *   5. Install PubSubClient library via Arduino Library Manager
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>

// ─────────────────────────────────────────────────────────────
// CONFIGURATION — Update these values for your network
// ─────────────────────────────────────────────────────────────
const char* ssid     = "Sun6_2108";
const char* password = "11223344";

// ─────────────────────────────────────────────────────────────
// MQTT CONFIGURATION — HiveMQ Cloud (TLS)
// ─────────────────────────────────────────────────────────────
const char* MQTT_BROKER    = "ad827adb37cb486d9a521c61763c31eb.s1.eu.hivemq.cloud";
const int   MQTT_PORT      = 8883;
const char* MQTT_USER      = "ESP32";
const char* MQTT_PASS      = "dazhop-Gexbej-1cuvcy";
const char* MQTT_CLIENT_ID = "ESP32_Relay_Controller";
const char* MQTT_TOPIC     = "Shreyansh/feeds/room-relay";

WebServer server(80);

// WiFiClientSecure skips certificate validation to avoid the
// heap overhead of storing a root CA on the ESP32.
WiFiClientSecure tlsClient;
PubSubClient     mqttClient(tlsClient);

// Tracks last reconnect attempt for non-blocking retry (millis)
unsigned long mqttLastReconnectAttempt = 0;

// ─────────────────────────────────────────────────────────────
// GPIO PIN MAPPING
// ─────────────────────────────────────────────────────────────
#define RELAY1 5
#define RELAY2 18
#define RELAY3 19
#define RELAY4 21

// Tracks on/off state for each relay (0-indexed internally)
bool relayState[4] = {false, false, false, false};

// ─────────────────────────────────────────────────────────────
// RELAY CONTROL
// ─────────────────────────────────────────────────────────────
void applyRelay(int id, bool state) {
  int pin;

  switch (id) {
    case 1: pin = RELAY1; break;
    case 2: pin = RELAY2; break;
    case 3: pin = RELAY3; break;
    case 4: pin = RELAY4; break;
    default: return;
  }

  relayState[id - 1] = state;

  // Active-LOW relay: LOW = ON, HIGH = OFF
  if (state) {
    digitalWrite(pin, LOW);
  } else {
    digitalWrite(pin, HIGH);
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP HANDLERS
// ─────────────────────────────────────────────────────────────

/**
 * GET /relays/status
 * Returns JSON array of all relay states
 */
void handleStatus() {
  String json = "[";

  for (int i = 0; i < 4; i++) {
    json += "{\"id\":" + String(i + 1) + ",\"isOn\":" + String(relayState[i] ? "true" : "false") + "}";

    if (i < 3) json += ",";
  }

  json += "]";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

/**
 * POST /relays/toggle?id=X&state=1|0
 * Toggles a specific relay
 */
void handleToggle() {
  // Handle CORS preflight
  if (server.method() == HTTP_OPTIONS) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
    server.send(204);
    return;
  }

  if (!server.hasArg("id") || !server.hasArg("state")) {
    server.send(400, "text/plain", "Missing parameters");
    return;
  }

  int id = server.arg("id").toInt();
  bool state = server.arg("state") == "1";

  applyRelay(id, state);

  String res = "{\"id\":" + String(id) + ",\"isOn\":" + String(state ? "true" : "false") + "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", res);
}

/**
 * GET /health
 * Simple health check endpoint
 */
void handleHealth() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "OK");
}

/**
 * Handle CORS preflight for all routes
 */
void handleCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

// ─────────────────────────────────────────────────────────────
// MQTT CALLBACK & RECONNECT
// ─────────────────────────────────────────────────────────────

/**
 * mqttCallback — invoked by PubSubClient whenever a message
 * arrives on a subscribed topic.
 *
 * topic   : the topic string
 * payload : raw bytes (NOT null-terminated)
 * length  : payload byte count
 *
 * Payload "1" → Relay 1 ON
 * Payload "0" → Relay 1 OFF
 */
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  // Convert payload bytes to a null-terminated String
  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print("[MQTT] Message on '");
  Serial.print(topic);
  Serial.print("': ");
  Serial.println(message);

  if (String(topic) == MQTT_TOPIC) {
    if (message == "1") {
      applyRelay(1, true);
      Serial.println("[MQTT] Relay 1 → ON");
    } else if (message == "0") {
      applyRelay(1, false);
      Serial.println("[MQTT] Relay 1 → OFF");
    } else {
      Serial.println("[MQTT] Unknown payload — ignored");
    }
  }
}

/**
 * mqttReconnect — non-blocking MQTT reconnect helper.
 * Call from loop(); uses a millis() gate so it only attempts
 * a reconnect every 5 seconds, never blocking HTTP handling.
 * Returns true if already connected.
 */
bool mqttReconnect() {
  if (mqttClient.connected()) return true;

  unsigned long now = millis();
  if (now - mqttLastReconnectAttempt < 5000UL) return false;

  mqttLastReconnectAttempt = now;

  Serial.print("[MQTT] Attempting connection… ");

  if (mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)) {
    Serial.println("connected!");
    mqttClient.subscribe(MQTT_TOPIC);
    Serial.print("[MQTT] Subscribed to: ");
    Serial.println(MQTT_TOPIC);
    return true;
  }

  Serial.print("failed, rc=");
  Serial.print(mqttClient.state());
  Serial.println(" — retrying in 5 s");
  return false;
}

// ─────────────────────────────────────────────────────────────
// SETUP & LOOP
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // Initialize relay pins as outputs (all OFF initially)
  pinMode(RELAY1, OUTPUT);
  pinMode(RELAY2, OUTPUT);
  pinMode(RELAY3, OUTPUT);
  pinMode(RELAY4, OUTPUT);

  // Active-LOW: HIGH = OFF
  digitalWrite(RELAY1, HIGH);
  digitalWrite(RELAY2, HIGH);
  digitalWrite(RELAY3, HIGH);
  digitalWrite(RELAY4, HIGH);

  // Connect to WiFi
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Connected! ESP32 IP: ");
  Serial.println(WiFi.localIP());

  // Start mDNS responder (access via http://esp32.local)
  if (!MDNS.begin("esp32")) {
    Serial.println("Error starting mDNS");
  } else {
    Serial.println("mDNS started: http://esp32.local");
    MDNS.addService("http", "tcp", 80);
  }

  // Register HTTP endpoints
  server.on("/relays/status", HTTP_GET, handleStatus);
  server.on("/relays/toggle", HTTP_POST, handleToggle);
  server.on("/relays/toggle", HTTP_OPTIONS, handleCors);
  server.on("/health", HTTP_GET, handleHealth);

  server.begin();
  Serial.println("HTTP server started");

  // ── MQTT setup ──────────────────────────────────────────────
  // setInsecure() disables certificate verification so the ESP32
  // does not need to store a root CA, preventing heap exhaustion.
  tlsClient.setInsecure();

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);

  // Attempt initial connection (blocking only on the first try)
  Serial.print("[MQTT] Connecting to broker… ");
  if (mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)) {
    Serial.println("connected!");
    mqttClient.subscribe(MQTT_TOPIC);
    Serial.print("[MQTT] Subscribed to: ");
    Serial.println(MQTT_TOPIC);
  } else {
    Serial.print("[MQTT] Initial connect failed, rc=");
    Serial.print(mqttClient.state());
    Serial.println(" — will retry in loop");
  }
}

void loop() {
  // ── HTTP ────────────────────────────────────────────────────
  server.handleClient();

  // ── MQTT ────────────────────────────────────────────────────
  // mqttReconnect() is non-blocking: it gates retries with a
  // millis() timer so the HTTP server is never starved.
  if (mqttReconnect()) {
    mqttClient.loop();
  }
}
