/*
 * WiFi CSI Presence Sensor - ESP32 Firmware
 * ==========================================
 * Extracts Channel State Information (CSI) from WiFi packets
 * and streams amplitude/phase data over UART at 921600 baud.
 *
 * Build with: idf.py build && idf.py flash
 * Requires: ESP-IDF v5.0+
 *
 * Setup:
 *   1. Set your WiFi credentials in WIFI_SSID / WIFI_PASS below
 *   2. Flash to ESP32 (NOT ESP32-S2/S3, vanilla ESP32 has best CSI support)
 *   3. Run the Python server: python server.py --port /dev/ttyUSB0
 */

#include <stdio.h>
#include <string.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "lwip/err.h"
#include "lwip/sockets.h"
#include "lwip/sys.h"
#include "lwip/netdb.h"
#include "lwip/dns.h"
#include "ping/ping_sock.h"

// ─── CONFIG ──────────────────────────────────────────────────────────────────
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASS       "YOUR_WIFI_PASSWORD"
#define PING_TARGET     "192.168.1.1"   // Your router IP — triggers CSI packets
#define PING_INTERVAL   50              // ms between pings (20 pings/sec)
#define UART_BAUD       921600          // High baud for CSI data volume
#define TAG             "CSI_RADAR"

// ─── GLOBALS ─────────────────────────────────────────────────────────────────
static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0

// ─── CSI CALLBACK ────────────────────────────────────────────────────────────
/*
 * Called for every WiFi packet received that has CSI data.
 * CSI buf format: [imag_0, real_0, imag_1, real_1, ...] as int8_t pairs
 * We output a CSV line: timestamp_ms,rssi,num_subcarriers,amp_0,amp_1,...
 */
static void wifi_csi_rx_cb(void *ctx, wifi_csi_info_t *data)
{
    if (!data || !data->buf) return;

    int8_t  *csi_buf    = data->buf;
    uint16_t num_sc     = data->len / 2;          // each subcarrier = 2 bytes (I+Q)
    int8_t   rssi       = data->rx_ctrl.rssi;
    uint32_t ts         = xTaskGetTickCount() * portTICK_PERIOD_MS;

    // Print header fields
    printf("CSI,%lu,%d,%u", (unsigned long)ts, (int)rssi, (unsigned int)num_sc);

    // Print amplitude for each subcarrier: sqrt(I^2 + Q^2), scaled to uint8
    for (int i = 0; i < num_sc; i++) {
        int8_t  imag = csi_buf[2 * i];
        int8_t  real = csi_buf[2 * i + 1];
        float   amp  = sqrtf((float)(imag * imag) + (float)(real * real));
        printf(",%d", (int)(amp));
    }
    printf("\n");
    fflush(stdout);
}

// ─── WIFI EVENTS ─────────────────────────────────────────────────────────────
static void event_handler(void *arg, esp_event_base_t base,
                           int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "WiFi disconnected, retrying...");
        esp_wifi_connect();
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

// ─── WIFI INIT ───────────────────────────────────────────────────────────────
static void wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t inst_any_id, inst_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL, &inst_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL, &inst_got_ip));

    wifi_config_t wifi_cfg;
    memset(&wifi_cfg, 0, sizeof(wifi_cfg));
    memcpy(wifi_cfg.sta.ssid, WIFI_SSID, strlen(WIFI_SSID));
    memcpy(wifi_cfg.sta.password, WIFI_PASS, strlen(WIFI_PASS));
    wifi_cfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    // ── Enable CSI ───────────────────────────────────────────────────────────
    // Configure what CSI data to collect
    wifi_csi_config_t csi_cfg = {
        .lltf_en           = true,    // Legacy Long Training Field
        .htltf_en          = true,    // HT Long Training Field
        .stbc_htltf2_en    = true,
        .ltf_merge_en      = true,
        .channel_filter_en = false,   // Raw CSI, no smoothing
        .manu_scale        = false,
    };
    ESP_ERROR_CHECK(esp_wifi_set_csi_config(&csi_cfg));
    ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(wifi_csi_rx_cb, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_csi(true));

    ESP_LOGI(TAG, "CSI enabled. Waiting for connection...");
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT,
                        pdFALSE, pdFALSE, portMAX_DELAY);
}

// ─── PING TASK ───────────────────────────────────────────────────────────────
/*
 * Continuously pings the router to generate a steady stream of
 * reply packets — each reply gives us a CSI measurement.
 */
static void ping_task(void *args)
{
    esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();

    // Resolve target IP
    ip_addr_t target_ip;
    ipaddr_aton(PING_TARGET, &target_ip);
    cfg.target_addr    = target_ip;
    cfg.interval_ms    = PING_INTERVAL;
    cfg.count          = ESP_PING_COUNT_INFINITE;
    cfg.timeout_ms     = 1000;
    cfg.data_size      = 32;

    esp_ping_callbacks_t cbs = {0};  // We don't need ping callbacks; CSI cb handles it
    esp_ping_handle_t ping;
    ESP_ERROR_CHECK(esp_ping_new_session(&cfg, &cbs, &ping));
    ESP_ERROR_CHECK(esp_ping_start(ping));

    ESP_LOGI(TAG, "Pinging %s every %dms for CSI triggers", PING_TARGET, PING_INTERVAL);
    vTaskDelete(NULL);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
void app_main(void)
{
    // Init NVS (required for WiFi)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Print a start marker so Python server knows ESP32 is alive
    printf("OPENCLAW_CSI_START\n");
    fflush(stdout);

    wifi_init_sta();

    // Launch ping task to generate steady CSI samples
    xTaskCreate(ping_task, "ping_task", 4096, NULL, 5, NULL);
}
