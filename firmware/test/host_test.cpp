// Host build of ecosort_io.h against a fake Serial. It plays a short session and writes the
// exact bytes the Nano would send to the file named on the command line. The backend test
// test_firmware_contract.py compiles this, runs it and feeds the bytes through the bridge's
// own parser, so the firmware and the bridge are checked against each other.
//
//   g++ -std=c++17 -static -I../ecosort_io host_test.cpp -o host_test && ./host_test out.bin

#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

struct FakeSerial {
  std::vector<uint8_t> out;
  std::string in;
  size_t in_pos = 0;
  bool open = false;

  explicit operator bool() const { return open; }
  size_t write(const uint8_t *data, size_t len) {
    out.insert(out.end(), data, data + len);
    return len;
  }
  int available() const { return static_cast<int>(in.size() - in_pos); }
  int read() { return in_pos < in.size() ? static_cast<unsigned char>(in[in_pos++]) : -1; }
};

FakeSerial Serial;
FakeSerial Serial1;

#define ECOSORT_PORT Serial
#define ECOSORT_MIRROR Serial1
#define ECOSORT_FIRMWARE_VERSION "1.0.0-host"
#define ECOSORT_OVERRIDE_EI_PRINTF
#include "ecosort_io.h"

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      std::fprintf(stderr, "host_test.cpp:%d: CHECK(%s)\n", __LINE__, #cond); \
      failures++;                                                      \
    }                                                                  \
  } while (0)

// A 96x96 gradient, the pattern test_firmware_contract.py expects.
static uint8_t frame[96 * 96];

int main(int argc, char **argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: host_test OUTPUT\n");
    return 2;
  }
  for (int y = 0; y < 96; y++) {
    for (int x = 0; x < 96; x++) frame[y * 96 + x] = static_cast<uint8_t>((x * 2 + y) & 0xFF);
  }

  // Port closed: nothing at all is sent, not even HELLO.
  ecosort::tick(0);
  ecosort::debugf("lost\n");
  ecosort::send_event("can", 0.9f, 400);
  CHECK(Serial.out.empty());

  // The host opens the port.
  Serial.open = true;
  ecosort::tick(10);                                   // HELLO,1.0.0-host
  ei_printf("Edge Impulse standalone inferencing (Arduino) with a long banner line\n");
  ei_printf("Predictions: ");                          // unfinished DBG line...
  ei_printf_float(-0.25f);
  ecosort::send_frame(ecosort::VERDICT, 96, 96, ecosort::read_gray_buffer, frame);
  ecosort::send_event("glass_bottle", 0.944f, 412);   // EVT,glass_bottle,0.94,RECYCLABLE,412
  ecosort::send_event("uncertain", 0.41f, 408);       // EVT,uncertain,0.41,NONE,408
  ecosort::send_event("pen", 0.999f, 1234567);        // confidence 1.00, latency capped
  ecosort::send_event("phone_case", -1.0f, 0);        // confidence 0.00
  ecosort::tick(5010);                                 // HB,5010

  // Host commands: P1 starts previews, junk is ignored, P0 stops them.
  CHECK(!ecosort::preview_requested());
  Serial.in = "P1\n";
  ecosort::tick(5100);
  CHECK(ecosort::preview_requested());
  CHECK(ecosort::preview_due(5100));
  CHECK(!ecosort::preview_due(5200));                  // 100 ms later: too soon
  ecosort::send_frame(ecosort::PREVIEW, 96, 96, ecosort::read_gray_buffer, frame);
  CHECK(ecosort::preview_due(5300));
  Serial.in += "P1XXXXXXXXXXXX\nP0\r\n";
  ecosort::tick(5400);
  CHECK(!ecosort::preview_requested());

  // The ESP32 mirror gets the EVT lines only, as text, whether or not a laptop has the USB
  // port open: the wireless dashboard works on its own.
  std::string mirror(Serial1.out.begin(), Serial1.out.end());
  CHECK(mirror.find("EVT,can,0.90,RECYCLABLE,400\nEVT,glass_bottle,0.94,RECYCLABLE,412\n") == 0);
  CHECK(mirror.find('\xEC') == std::string::npos);
  CHECK(mirror.find("DBG") == std::string::npos);

  FILE *f = std::fopen(argv[1], "wb");
  if (f == nullptr) return 2;
  std::fwrite(Serial.out.data(), 1, Serial.out.size(), f);
  std::fclose(f);
  return failures == 0 ? 0 : 1;
}
