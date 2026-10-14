/*
  ecosort_io.h: the EcoSort Edge wire protocol for the Nano 33 BLE Sense (nRF52840).

  Copy this file next to your sketch and include it once. It keeps the bridge's contract:

    HELLO,<version>                       once, when the host first opens the port
    HB,<uptime_ms>                        every 5 s while the host has the port open
    EVT,<label>,<0.00-1.00>,<BIN>,<ms>    one per classification
    DBG,<text>                            everything else, split to fit 64 bytes
    frame packet                          magic EC A5 F0 5A, type, w, h, length, pixels, CRC

  Rules it enforces:
    - One output function (write_bytes). Each line or packet is written whole before the
      next one starts, and an unfinished DBG line is closed first, so nothing interleaves.
    - No String objects, no heap, no delay().
    - Frames stream from the caller's existing buffer in 64-pixel chunks through a reader
      callback. There is no second frame buffer.
    - Nothing is sent until the host has opened the port (Serial is true).

  RAM: 70 bytes of static state (60-byte DBG line, 8-byte command buffer, flags and
  timers). While a frame is sent: a 64-byte chunk on the stack, plus whatever the reader
  uses (the Edge Impulse reader in INTEGRATION.md adds 256 bytes of floats). A 96x96 frame
  is never copied; a second buffer would have cost 9216 bytes.
*/
#pragma once

#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifndef ECOSORT_PORT
#define ECOSORT_PORT Serial
#endif

#ifndef ECOSORT_FIRMWARE_VERSION
#define ECOSORT_FIRMWARE_VERSION "1.0.0"
#endif

namespace ecosort {

enum FrameType : uint8_t { PREVIEW = 1, VERDICT = 2 };

const size_t MAX_LINE = 64;               // bytes before the newline; longer lines are dropped
const size_t DBG_TEXT = MAX_LINE - 4;     // room left after "DBG,"
const uint32_t HEARTBEAT_MS = 5000;
const uint32_t PREVIEW_INTERVAL_MS = 200; // at most 5 preview frames per second
const size_t CHUNK = 64;
const uint32_t MAX_PAYLOAD = 16384;

// Called by send_frame for each chunk: fill out[0..count) with 8-bit gray pixels starting
// at pixel `offset` (row-major) of the frame the model sees.
typedef void (*GrayReader)(size_t offset, size_t count, uint8_t *out, void *context);

namespace detail {
static bool preview_on = false;
static bool hello_sent = false;
static uint32_t last_heartbeat_ms = 0;
static uint32_t last_preview_ms = 0;
static char command[8];
static uint8_t command_len = 0;
static bool command_overflow = false;
static char dbg[DBG_TEXT];
static uint8_t dbg_len = 0;
}  // namespace detail

inline bool host_open() { return static_cast<bool>(ECOSORT_PORT); }

// The single output function. Everything the Nano sends goes through here.
inline void write_bytes(const uint8_t *data, size_t len) {
  if (len == 0 || !host_open()) return;
  ECOSORT_PORT.write(data, len);
}

inline void write_text(const char *text, size_t len) {
  write_bytes(reinterpret_cast<const uint8_t *>(text), len);
}

// -- debug text --------------------------------------------------------------------------

// Close any unfinished DBG line, so a packet or protocol line never lands inside it.
inline void dbg_flush() {
  if (detail::dbg_len == 0) return;
  char line[MAX_LINE + 1];
  memcpy(line, "DBG,", 4);
  memcpy(line + 4, detail::dbg, detail::dbg_len);
  line[4 + detail::dbg_len] = '\n';
  write_text(line, 5 + detail::dbg_len);
  detail::dbg_len = 0;
}

inline void dbg_putc(char c) {
  if (c == '\r') return;
  if (c == '\n') {
    dbg_flush();
    return;
  }
  if (c < 0x20 || c > 0x7e) c = '?';  // DBG text must be printable ASCII
  detail::dbg[detail::dbg_len++] = c;
  if (detail::dbg_len == DBG_TEXT) dbg_flush();
}

inline void vdebugf(const char *format, va_list args) {
  char text[128];
  int n = vsnprintf(text, sizeof text, format, args);
  if (n < 0) return;
  size_t len = static_cast<size_t>(n) < sizeof text ? static_cast<size_t>(n) : sizeof text - 1;
  for (size_t i = 0; i < len; i++) dbg_putc(text[i]);
}

// printf-style debug output, sent as DBG lines.
inline void debugf(const char *format, ...) {
  va_list args;
  va_start(args, format);
  vdebugf(format, args);
  va_end(args);
}

// -- protocol lines ----------------------------------------------------------------------

inline void send_line(const char *line, int len) {
  if (len <= 0) return;
  size_t n = static_cast<size_t>(len);
  if (n > MAX_LINE + 1) return;  // never send a line the bridge would drop
  dbg_flush();
  write_text(line, n);
}

inline void send_hello() {
  char line[MAX_LINE + 2];
  send_line(line, snprintf(line, sizeof line, "HELLO,%s\n", ECOSORT_FIRMWARE_VERSION));
}

inline void send_heartbeat(uint32_t uptime_ms) {
  char line[MAX_LINE + 2];
  send_line(line, snprintf(line, sizeof line, "HB,%lu\n", static_cast<unsigned long>(uptime_ms)));
}

// The lookup table, not the model, decides the bin. The bridge recomputes it from its own
// table and counts any disagreement.
inline const char *bin_for(const char *label) {
  if (strcmp(label, "can") == 0 || strcmp(label, "glass_bottle") == 0) return "RECYCLABLE";
  if (strcmp(label, "pen") == 0 || strcmp(label, "phone_case") == 0) return "TRASH";
  return "NONE";
}

// One EVT line. Confidence is written with integer arithmetic: no float printf needed.
inline void send_event(const char *label, float confidence, uint32_t latency_ms) {
  if (!(confidence >= 0.0f)) confidence = 0.0f;  // also catches NaN
  if (confidence > 1.0f) confidence = 1.0f;
  unsigned hundredths = static_cast<unsigned>(confidence * 100.0f + 0.5f);
  if (hundredths > 100) hundredths = 100;
  if (latency_ms > 999999UL) latency_ms = 999999UL;
  char line[MAX_LINE + 2];
  int n = snprintf(line, sizeof line, "EVT,%s,%u.%02u,%s,%lu\n", label, hundredths / 100,
                   hundredths % 100, bin_for(label), static_cast<unsigned long>(latency_ms));
  send_line(line, n);
#ifdef ECOSORT_MIRROR
  // Text-only copy for the optional ESP32 dashboard. Frames never go to Serial1.
  if (n > 0 && static_cast<size_t>(n) <= MAX_LINE + 1) {
    ECOSORT_MIRROR.write(reinterpret_cast<const uint8_t *>(line), static_cast<size_t>(n));
  }
#endif
}

// -- frames ------------------------------------------------------------------------------

inline uint16_t crc16_update(uint16_t crc, uint8_t byte) {
  // CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor.
  crc ^= static_cast<uint16_t>(byte) << 8;
  for (int bit = 0; bit < 8; bit++) {
    crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
                         : static_cast<uint16_t>(crc << 1);
  }
  return crc;
}

// Stream one frame packet. The reader is called for 64 pixels at a time, so the pixels
// come straight from the buffer the model read.
inline void send_frame(FrameType type, uint16_t width, uint16_t height, GrayReader reader,
                       void *context) {
  const uint32_t length = static_cast<uint32_t>(width) * height;
  if (length == 0 || length > MAX_PAYLOAD || !host_open()) return;
  dbg_flush();
  const uint8_t head[13] = {
      0xEC, 0xA5, 0xF0, 0x5A,
      static_cast<uint8_t>(type),
      static_cast<uint8_t>(width & 0xFF), static_cast<uint8_t>(width >> 8),
      static_cast<uint8_t>(height & 0xFF), static_cast<uint8_t>(height >> 8),
      static_cast<uint8_t>(length & 0xFF), static_cast<uint8_t>((length >> 8) & 0xFF),
      static_cast<uint8_t>((length >> 16) & 0xFF), static_cast<uint8_t>(length >> 24),
  };
  uint16_t crc = 0xFFFF;
  for (size_t i = 4; i < sizeof head; i++) crc = crc16_update(crc, head[i]);
  write_bytes(head, sizeof head);

  uint8_t chunk[CHUNK];
  for (uint32_t offset = 0; offset < length; offset += CHUNK) {
    size_t count = (length - offset) < CHUNK ? (length - offset) : CHUNK;
    reader(offset, count, chunk, context);
    for (size_t i = 0; i < count; i++) crc = crc16_update(crc, chunk[i]);
    write_bytes(chunk, count);
  }
  const uint8_t tail[2] = {static_cast<uint8_t>(crc & 0xFF), static_cast<uint8_t>(crc >> 8)};
  write_bytes(tail, sizeof tail);
}

// Reader for a plain 8-bit grayscale buffer. Pass the buffer as the context.
inline void read_gray_buffer(size_t offset, size_t count, uint8_t *out, void *context) {
  memcpy(out, static_cast<const uint8_t *>(context) + offset, count);
}

// -- host commands and housekeeping ------------------------------------------------------

inline void handle_command() {
  if (detail::command_len == 2 && detail::command[0] == 'P') {
    if (detail::command[1] == '1') {
      detail::preview_on = true;
      detail::last_preview_ms = 0;
    } else if (detail::command[1] == '0') {
      detail::preview_on = false;
    }
  }
}

// Read whatever command bytes have arrived. Never waits.
inline void poll_commands() {
  while (ECOSORT_PORT.available() > 0) {
    int c = ECOSORT_PORT.read();
    if (c < 0) break;
    if (c == '\n' || c == '\r') {
      if (!detail::command_overflow && detail::command_len > 0) handle_command();
      detail::command_len = 0;
      detail::command_overflow = false;
    } else if (detail::command_len < sizeof detail::command) {
      detail::command[detail::command_len++] = static_cast<char>(c);
    } else {
      detail::command_overflow = true;
    }
  }
}

// Call at the top of every loop(). Sends HELLO once the host opens the port, reads
// commands, and sends the heartbeat.
inline void tick(uint32_t now_ms) {
  if (!host_open()) {
    detail::preview_on = false;  // the bridge sends P1 again when it reconnects
    return;
  }
  if (!detail::hello_sent) {
    send_hello();
    detail::hello_sent = true;
    detail::last_heartbeat_ms = now_ms;
  }
  poll_commands();
  if (now_ms - detail::last_heartbeat_ms >= HEARTBEAT_MS) {
    detail::last_heartbeat_ms = now_ms;
    send_heartbeat(now_ms);
  }
}

inline bool preview_requested() { return detail::preview_on && host_open(); }

// True when a preview frame should be sent now: requested, and 200 ms since the last one.
inline bool preview_due(uint32_t now_ms) {
  if (!preview_requested()) return false;
  if (detail::last_preview_ms != 0 && now_ms - detail::last_preview_ms < PREVIEW_INTERVAL_MS) {
    return false;
  }
  detail::last_preview_ms = now_ms == 0 ? 1 : now_ms;
  return true;
}

}  // namespace ecosort

#ifdef ECOSORT_OVERRIDE_EI_PRINTF
// Edge Impulse's Arduino port defines these as weak symbols. These versions turn all of the
// SDK's and the example's printing into DBG lines, which the bridge ignores.
void ei_printf(const char *format, ...) {
  va_list args;
  va_start(args, format);
  ecosort::vdebugf(format, args);
  va_end(args);
}

void ei_printf_float(float f) {
  const char *sign = f < 0.0f ? "-" : "";
  if (f < 0.0f) f = -f;
  long whole = static_cast<long>(f);
  long frac = static_cast<long>((f - static_cast<float>(whole)) * 100000.0f);
  ecosort::debugf("%s%ld.%05ld", sign, whole, frac);
}
#endif
