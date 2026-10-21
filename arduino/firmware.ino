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
static const uint8_t ACK_COMMAND = 0x81;
static const size_t FRAME_SIZE = 11;
static uint8_t frame[FRAME_SIZE];
static size_t used = 0;

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

void handleFrame() {
  if (frame[0] != FRAME_START || frame[10] != FRAME_END ||
      frame[1] != VERSION || frame[2] != COMMAND_WORD) return;
  const uint16_t receivedCrc = frame[8] | (uint16_t(frame[9]) << 8);
  if (crc16(&frame[1], 7) != receivedCrc) return;

  const uint8_t sequence = frame[3];
  const uint32_t arincWord = uint32_t(frame[4]) |
    (uint32_t(frame[5]) << 8) | (uint32_t(frame[6]) << 16) |
    (uint32_t(frame[7]) << 24);
  (void) arincWord;

  // TODO: decodificar conforme al instrumento y manejar salida tras diseño,
  // revisión eléctrica y pruebas. No se accionan pines en este firmware base.
  sendAck(sequence);  // ACK significa trama validada/recibida, no A/B transmitido.
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  while (Serial.available() > 0) {
    const uint8_t incoming = Serial.read();
    if (used == 0 && incoming != FRAME_START) continue;
    if (used < FRAME_SIZE) frame[used++] = incoming;
    if (used == FRAME_SIZE) {
      handleFrame();
      used = 0;
    }
  }
}
