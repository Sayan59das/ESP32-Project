# Wiring `ecosort_io.h` into the Nano sketch

`ecosort_io.h` carries the whole wire contract: one output function, the HELLO, HB, EVT
and DBG lines, frame packets streamed from the existing buffer, and the P1/P0 command
reader. The changes below put it into a sketch built from Edge Impulse's
`nano_ble33_sense_camera` example. The function names (`ei_camera_capture`,
`ei_camera_cutout_get_data` and so on) are the example's. If your sketch renamed them, or
moved the IR trigger elsewhere, the hunks still show where each change goes.

`firmware/test/host_test.cpp` compiles the header on a PC against a fake `Serial`, and
`backend/tests/test_firmware_contract.py` feeds its output through the bridge's parser.
Run `make test` after changing the header.

## What changes, and why

| Contract item | Where it happens |
| --- | --- |
| (a) One output function, nothing interleaved, frames in chunks from the existing buffer | `ecosort::write_bytes`, `ecosort::send_frame` with `read_model_input` below |
| (b) HELLO, HB and frame output | `ecosort::tick` (HELLO once, HB every 5 s), `send_frame`, `send_event` |
| (c) Host commands read without blocking | `ecosort::tick` calls `poll_commands`, which only reads bytes already waiting |
| (d) Edge Impulse text becomes DBG lines | `ECOSORT_OVERRIDE_EI_PRINTF` replaces the SDK's weak `ei_printf` and `ei_printf_float` |
| (e) Optional EVT mirror for the ESP32 | `#define ECOSORT_MIRROR Serial1` |

## 1. Top of the sketch

```diff
 #include <your_project_inferencing.h>
 #include <Arduino_OV767X.h>
+
+#define ECOSORT_FIRMWARE_VERSION "ecosort-1.0"
+#define ECOSORT_OVERRIDE_EI_PRINTF
+// #define ECOSORT_MIRROR Serial1   // uncomment to copy EVT lines to the ESP32
+#include "ecosort_io.h"
+
+static const float UNSURE_BELOW = 0.60f;  // top score under this is reported as "uncertain"
```

If the linker reports `ei_printf` defined twice, your Edge Impulse library does not mark it
weak. Remove `#define ECOSORT_OVERRIDE_EI_PRINTF` and change the sketch's own `ei_printf`
calls to `ecosort::debugf`.

## 2. `setup()`: no waiting for the port, camera initialised once

```diff
 void setup() {
     Serial.begin(115200);
-    while (!Serial);
-    Serial.println("Edge Impulse Inferencing Demo");
+    // Do not wait for the port. ecosort_io sends nothing until the host opens it, and the
+    // Nano keeps working without a laptop.
+    // Serial1.begin(115200);   // with ECOSORT_MIRROR
+
+    // Initialise the camera and its capture buffer once, not on every loop, so previews
+    // can run at 5 frames per second. This is the same buffer the example allocated in
+    // loop(); moving the allocation here adds no RAM.
+    if (!ei_camera_init()) ecosort::debugf("camera init failed\n");
+    ei_camera_capture_out = (uint8_t *)ei_malloc(resize_col_sz * resize_row_sz * 2 + 32);
 }
```

Keep the example's sizing code that sets `resize_col_sz` and `resize_row_sz` before the
allocation.

## 3. A reader that streams the model's input as gray

`ei_camera_cutout_get_data` already produces the exact pixels the classifier reads, packed
as `0xRRGGBB` in a float. The reader converts 64 of them at a time to 8-bit gray with the
same weights Edge Impulse's grayscale step uses. It uses 256 bytes of stack and no frame
buffer.

```cpp
static void read_model_input(size_t offset, size_t count, uint8_t *out, void *) {
  float rgb[ecosort::CHUNK];
  ei_camera_cutout_get_data(offset, count, rgb);
  for (size_t i = 0; i < count; i++) {
    const uint32_t p = static_cast<uint32_t>(rgb[i]);
    const uint32_t r = p >> 16, g = (p >> 8) & 0xFF, b = p & 0xFF;
    out[i] = static_cast<uint8_t>((r * 299u + g * 587u + b * 114u) / 1000u);
  }
}
```

## 4. `loop()`: event-driven, never blocking

```diff
 void loop() {
-    bool stop_inferencing = false;
-    while (stop_inferencing == false) {
-        ei_printf("\nStarting inferencing in 2 seconds...\n");
-        if (ei_sleep(2000) != EI_IMPULSE_OK) { break; }
-        ...
-        while (ei_get_serial_available() > 0) {
-            if (ei_get_serial_byte() == 'b') { stop_inferencing = true; }
-        }
-    }
-    ei_camera_deinit();
+    const uint32_t now = millis();
+    ecosort::tick(now);                   // HELLO, heartbeat, P1/P0
+
+    if (object_detected()) {              // your IR sensor check, with its debounce
+        classify_and_report();
+    } else if (ecosort::preview_due(now)) {
+        // Previews only between classifications, at most 5 per second, only while asked.
+        if (ei_camera_capture(EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT, NULL)) {
+            ecosort::send_frame(ecosort::PREVIEW, EI_CLASSIFIER_INPUT_WIDTH,
+                                EI_CLASSIFIER_INPUT_HEIGHT, read_model_input, nullptr);
+        }
+    }
 }
+
+static void classify_and_report() {
+    if (!ei_camera_capture(EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT, NULL)) {
+        ecosort::debugf("capture failed\n");
+        return;
+    }
+    ei::signal_t signal;
+    signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
+    signal.get_data = &ei_camera_cutout_get_data;
+    ei_impulse_result_t result = { 0 };
+
+    const uint32_t started = millis();
+    if (run_classifier(&signal, &result, false) != EI_IMPULSE_OK) {
+        ecosort::debugf("classifier failed\n");
+        return;
+    }
+    const uint32_t inference_ms = millis() - started;  // on the Nano only, not end to end
+
+    size_t top = 0;
+    for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
+        if (result.classification[i].value > result.classification[top].value) top = i;
+    }
+    const char *label = result.classification[top].label;
+    const float confidence = result.classification[top].value;
+    if (strcmp(label, "background") == 0) return;  // nothing there: send nothing, count nothing
+    if (confidence < UNSURE_BELOW) label = "uncertain";
+
+    // The exact frame the model just classified, immediately before its EVT line. The
+    // capture buffer is untouched since run_classifier read it.
+    ecosort::send_frame(ecosort::VERDICT, EI_CLASSIFIER_INPUT_WIDTH,
+                        EI_CLASSIFIER_INPUT_HEIGHT, read_model_input, nullptr);
+    ecosort::send_event(label, confidence, inference_ms);
+}
```

Delete the example's per-loop `ei_malloc`/`ei_free` of `ei_camera_capture_out` and its
prediction printing loop. Any remaining `ei_printf` output becomes DBG lines that the
bridge ignores.

## RAM

| Item | Bytes | When |
| --- | --- | --- |
| `ecosort_io.h` static state | about 70 | always |
| Line buffer in `send_event` and friends | 66 | stack, while a line is written |
| Frame chunk | 64 | stack, while a frame is sent |
| `read_model_input` scratch (64 floats) | 256 | stack, while a frame is sent |
| Second frame buffer | 0 | never: frames stream from the capture buffer |

A copy of the 96x96 frame would have cost 9216 bytes. The capture buffers the Edge Impulse
example already allocates are unchanged; they are only allocated once instead of on every
loop.
