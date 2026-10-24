// EcoSort Edge: an ESP32 as the camera board.
//
// Streams the camera as 160 by 120 grayscale frames over USB serial, in the same "FRM0"
// format the Arduino camera sketch (cam_stream) sends and Model/camera_bridge.py reads:
//
//   'F' 'R' 'M' '0'   width (2 bytes, little endian)   height (2 bytes, little endian)
//   then width * height grayscale bytes, one byte per pixel
//
// Nothing else is needed on the laptop: the camera bridge scans the serial ports, finds
// this board and starts counting. Guide, wiring and troubleshooting:
// firmware/ESP32_CAMERA.md
//
// It does no classifying. The trained model runs on the laptop.
//
// Board support: ESP32 Arduino core with the esp32-camera driver (esp_camera.h). Written for
// the Arduino Nano ESP32 core (arduino:esp32) and the Espressif core (esp32:esp32).
//
// The only text it prints is a line starting with INIT, which the camera bridge shows in its
// window ("board says: INIT FAILED ..."). Anything else would be skipped as noise.

#include "esp_camera.h"

// ---- 1. Which board? ------------------------------------------------------------------
// Uncomment ONE. With neither, the Arduino Nano ESP32 with an OV7670/OV7675 module is used.
// To use your own wiring, edit the pin numbers in that board's block below.
//
// #define BOARD_NANO_ESP32_OV767X   // Arduino Nano ESP32 + OV7670 or OV7675 module
// #define BOARD_AI_THINKER          // AI-Thinker ESP32-CAM (OV2640 on the board)

#if !defined(BOARD_NANO_ESP32_OV767X) && !defined(BOARD_AI_THINKER)
#define BOARD_NANO_ESP32_OV767X
#endif

// ---- 2. Pins. These are GPIO NUMBERS, not Arduino D/A labels ----------------------------
// (The camera driver talks to the chip directly, so the Nano ESP32's pin-label remapping
// does not apply to it.)

#if defined(BOARD_NANO_ESP32_OV767X)
// Camera module pin -> Nano ESP32 label (GPIO)
#define CAM_PWDN -1    // PWDN: connect to GND on the module
#define CAM_RESET -1   // RESET: connect to 3V3 on the module
#define CAM_XCLK 21    // XCLK -> D10 (GPIO21)
#define CAM_SIOD 11    // SIOD / SDA -> A4 (GPIO11)
#define CAM_SIOC 12    // SIOC / SCL -> A5 (GPIO12)
#define CAM_D0 5       // D0 -> D2 (GPIO5)
#define CAM_D1 6       // D1 -> D3 (GPIO6)
#define CAM_D2 7       // D2 -> D4 (GPIO7)
#define CAM_D3 8       // D3 -> D5 (GPIO8)
#define CAM_D4 9       // D4 -> D6 (GPIO9)
#define CAM_D5 10      // D5 -> D7 (GPIO10)
#define CAM_D6 17      // D6 -> D8 (GPIO17)
#define CAM_D7 18      // D7 -> D9 (GPIO18)
#define CAM_VSYNC 47   // VSYNC -> D12 (GPIO47)
#define CAM_HREF 1     // HREF -> A0 (GPIO1)
#define CAM_PCLK 38    // PCLK -> D11 (GPIO38)
#define CAM_XCLK_HZ 20000000
#elif defined(BOARD_AI_THINKER)
#define CAM_PWDN 32
#define CAM_RESET -1
#define CAM_XCLK 0
#define CAM_SIOD 26
#define CAM_SIOC 27
#define CAM_D0 5
#define CAM_D1 18
#define CAM_D2 19
#define CAM_D3 21
#define CAM_D4 36
#define CAM_D5 39
#define CAM_D6 34
#define CAM_D7 35
#define CAM_VSYNC 25
#define CAM_HREF 23
#define CAM_PCLK 22
#define CAM_XCLK_HZ 20000000
#endif

// ---- 3. Picture ------------------------------------------------------------------------
#define FRAME_SIZE FRAMESIZE_QQVGA  // 160 by 120: what the model was trained on
#define CAM_VFLIP 0                 // 1 if the picture is upside down
#define CAM_HMIRROR 0               // 1 if the picture is mirrored
#define SERIAL_BAUD 921600          // ignored over native USB; the bridge also opens at this rate

static const uint8_t MAGIC[4] = {'F', 'R', 'M', '0'};
static bool cameraReady = false;
static uint8_t missedFrames = 0;

static bool startCamera() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = CAM_D0;
  config.pin_d1 = CAM_D1;
  config.pin_d2 = CAM_D2;
  config.pin_d3 = CAM_D3;
  config.pin_d4 = CAM_D4;
  config.pin_d5 = CAM_D5;
  config.pin_d6 = CAM_D6;
  config.pin_d7 = CAM_D7;
  config.pin_xclk = CAM_XCLK;
  config.pin_pclk = CAM_PCLK;
  config.pin_vsync = CAM_VSYNC;
  config.pin_href = CAM_HREF;
  config.pin_sccb_sda = CAM_SIOD;
  config.pin_sccb_scl = CAM_SIOC;
  config.pin_pwdn = CAM_PWDN;
  config.pin_reset = CAM_RESET;
  config.xclk_freq_hz = CAM_XCLK_HZ;
  config.pixel_format = PIXFORMAT_GRAYSCALE;
  config.frame_size = FRAME_SIZE;
  config.jpeg_quality = 12;  // unused for grayscale, but the driver wants a value
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_DRAM;  // 19 KB per frame: no PSRAM needed
  config.grab_mode = CAMERA_GRAB_LATEST;   // always the newest frame, never a queued old one

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    // The camera bridge shows this line. 0x105 means the sensor did not answer on the
    // SCCB/I2C pins: check the wiring and the power.
    Serial.printf("\nINIT FAILED camera 0x%x\n", err);
    return false;
  }

  sensor_t *sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_vflip(sensor, CAM_VFLIP);
    sensor->set_hmirror(sensor, CAM_HMIRROR);
    Serial.printf("\nINIT OK camera pid 0x%x, 160x120 grayscale\n", sensor->id.PID);
  }
  return true;
}

void setup() {
  // No wait for a serial monitor: the board must start streaming by itself.
  Serial.begin(SERIAL_BAUD);
  delay(300);
  cameraReady = startCamera();
}

void loop() {
  if (!cameraReady) {
    delay(2000);  // try again, so plugging the camera in later still works
    esp_camera_deinit();
    cameraReady = startCamera();
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (fb == nullptr) {
    // No frame. After a second or so of that the camera is not there: start over.
    delay(50);
    if (++missedFrames >= 20) {
      missedFrames = 0;
      Serial.println("\nINIT FAILED camera stopped sending frames");
      esp_camera_deinit();
      cameraReady = false;
    }
    return;
  }
  missedFrames = 0;

  const size_t pixels = (size_t)fb->width * fb->height;
  if (fb->format == PIXFORMAT_GRAYSCALE && fb->len == pixels) {
    uint8_t header[8] = {
        MAGIC[0], MAGIC[1], MAGIC[2], MAGIC[3],
        (uint8_t)(fb->width & 0xFF), (uint8_t)(fb->width >> 8),
        (uint8_t)(fb->height & 0xFF), (uint8_t)(fb->height >> 8)};
    Serial.write(header, sizeof(header));
    Serial.write(fb->buf, fb->len);
  }
  esp_camera_fb_return(fb);
}
