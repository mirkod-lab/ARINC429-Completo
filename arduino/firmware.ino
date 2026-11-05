/*
 * Interfaz de firmware educativa: NO genera ARINC 429 físico por sí sola.
 * Antes de habilitar salidas deben definirse modelo, pines, temporización,
 * estados A/B (incluido triestado/complementario) y el esquema del driver.
 * No conectar señales de +/-10 V a pines del Arduino.
 */
#include <Arduino.h>

static const uint8_t FRAME_START = 0x02;
static const uint8_t FRAME_END = 0x03;
static const uint8_t VERSION = 1;
static const uint8_t COMMAND_WORD = 0x01;
static const uint8_t COMMAND_WORD_METADATA = 0x02;
static const uint8_t ACK_COMMAND = 0x81;
static const size_t LEGACY_FRAME_SIZE = 11;
static const size_t METADATA_FRAME_SIZE = 70;
static const size_t MAX_FRAME_SIZE = METADATA_FRAME_SIZE;
static uint8_t frame[MAX_FRAME_SIZE];
static size_t used = 0;
static size_t expectedSize = 0;

uint16_t crc16(const uint8_t *data, size_t length) {
  uint16_t crc = 0xffff;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc;
}

void sendAck(uint8_t sequence) {
  uint8_t ack[7] = {FRAME_START, VERSION, ACK_COMMAND, sequence, 0, 0, FRAME_END};
  const uint16_t crc = crc16(&ack[1], 3);
  ack[4] = crc & 0xff;
  ack[5] = crc >> 8;
  ack[6] = FRAME_END;
  Serial.write(ack, sizeof(ack));
}

bool validateFrame() {
  if (frame[0] != FRAME_START || frame[1] != VERSION) return false;
  size_t crcOffset;
  size_t crcLength;

  if (frame[2] == COMMAND_WORD && expectedSize == LEGACY_FRAME_SIZE) {
    if (frame[10] != FRAME_END) return false;
    crcOffset = 8;
    crcLength = 7;
  } else if (frame[2] == COMMAND_WORD_METADATA && expectedSize == METADATA_FRAME_SIZE) {
    if (frame[69] != FRAME_END ||
        frame[8] == 0 || frame[8] > 24 ||
        frame[33] > 12 ||
        frame[46] == 0 || frame[46] > 20) return false;
    crcOffset = 67;
    crcLength = 66;
  } else {
    return false;
  }

  const uint16_t receivedCrc = frame[crcOffset] | (uint16_t(frame[crcOffset + 1]) << 8);
  return crc16(&frame[1], crcLength) == receivedCrc;
}

void handleFrame() {
  if (!validateFrame()) return;

  const uint8_t sequence = frame[3];
  const uint32_t arincWord = uint32_t(frame[4]) |
    (uint32_t(frame[5]) << 8) | (uint32_t(frame[6]) << 16) |
    (uint32_t(frame[7]) << 24);
  (void) arincWord;

  // Este firmware valida y confirma la trama; el firmware receptor con LCD
  // presenta los metadatos de instrumento y valor.
  sendAck(sequence);  // ACK significa trama validada/recibida, no A/B transmitido.
}

void receiveByte(uint8_t incoming) {
  if (used == 0) {
    if (incoming != FRAME_START) return;
    frame[used++] = incoming;
    return;
  }

  if (used >= MAX_FRAME_SIZE) {
    used = 0;
    expectedSize = 0;
    return;
  }
  frame[used++] = incoming;

  if (used == 3) {
    if (frame[2] == COMMAND_WORD) expectedSize = LEGACY_FRAME_SIZE;
    else if (frame[2] == COMMAND_WORD_METADATA) expectedSize = METADATA_FRAME_SIZE;
    else {
      used = 0;
      expectedSize = 0;
      return;
    }
  }

  if (expectedSize != 0 && used == expectedSize) {
    handleFrame();
    used = 0;
    expectedSize = 0;
  }
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  while (Serial.available() > 0) {
    receiveByte(static_cast<uint8_t>(Serial.read()));
  }
}
