const START = 0x02;
const END = 0x03;
const VERSION = 1;
const COMMAND_WORD = 0x01;
const COMMAND_WORD_METADATA = 0x02;
const MAX_INSTRUMENT_LENGTH = 24;
const MAX_UNIT_LENGTH = 12;
const MAX_VALUE_LENGTH = 20;

function crc16(buffer) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

function normalizeDisplayText(value, field, maxLength, required = false) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`El campo ${field} debe ser texto.`);
  }
  const text = String(value)
    .replace(/[°º]/g, 'deg')
    .replace(/[µμ]/g, 'u')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '?');
  if ((required && text.length === 0) || text.length > maxLength) {
    throw new Error(`El campo ${field} debe tener entre ${required ? 1 : 0} y ${maxLength} caracteres ASCII.`);
  }
  return Buffer.from(text, 'ascii');
}

function makeFrame(word, sequence, metadata) {
  if (metadata) {
    const instrument = normalizeDisplayText(metadata.instrument, 'instrumento', MAX_INSTRUMENT_LENGTH, true);
    const unit = normalizeDisplayText(metadata.unit ?? '', 'unidad', MAX_UNIT_LENGTH);
    const value = normalizeDisplayText(metadata.value, 'valor', MAX_VALUE_LENGTH, true);
    const content = Buffer.alloc(3 + 4 + 1 + MAX_INSTRUMENT_LENGTH + 1 + MAX_UNIT_LENGTH + 1 + MAX_VALUE_LENGTH);
    content[0] = VERSION;
    content[1] = COMMAND_WORD_METADATA;
    content[2] = sequence & 0xff;
    content.writeUInt32LE(word >>> 0, 3);
    let offset = 7;
    content[offset++] = instrument.length;
    instrument.copy(content, offset);
    offset += MAX_INSTRUMENT_LENGTH;
    content[offset++] = unit.length;
    unit.copy(content, offset);
    offset += MAX_UNIT_LENGTH;
    content[offset++] = value.length;
    value.copy(content, offset);

    const crc = crc16(content);
    const checksum = Buffer.alloc(2);
    checksum.writeUInt16LE(crc);
    return Buffer.concat([Buffer.from([START]), content, checksum, Buffer.from([END])]);
  }

  const content = Buffer.alloc(9);
  content[0] = VERSION;
  content[1] = COMMAND_WORD;
  content[2] = sequence & 0xff;
  content.writeUInt32LE(word >>> 0, 3);
  const crc = crc16(content.subarray(0, 7));
  content.writeUInt16LE(crc, 7);
  return Buffer.concat([Buffer.from([START]), content, Buffer.from([END])]);
}

function parseAck(frame, expectedSequence) {
  if (frame.length !== 7 || frame[0] !== START || frame[6] !== END) {
    throw new Error('El Arduino devolvió una trama ACK con encuadre incorrecto.');
  }
  if (frame[1] !== VERSION || frame[2] !== 0x81 || frame[3] !== expectedSequence) {
    throw new Error('La confirmación no corresponde a la versión, comando o secuencia esperados.');
  }
  const expectedCrc = crc16(frame.subarray(1, 4));
  if (frame.readUInt16LE(4) !== expectedCrc) throw new Error('CRC inválido en la confirmación serial.');
  return true;
}

function createSerialService({ env = process.env, logger = console } = {}) {
  let sequence = 0;
  let port;

  function mode() {
    return env.SERIAL_MODE === 'hardware' ? 'hardware' : 'simulation';
  }

  async function listPorts() {
    if (mode() === 'simulation') return [];
    let SerialPort;
    try {
      ({ SerialPort } = require('serialport'));
    } catch (error) {
      throw new Error(`No se pudo cargar serialport: ${error.message}`);
    }
    return SerialPort.list();
  }

  async function sendWord(word, portPath, metadata) {
    if (mode() === 'simulation') {
      return { mode: 'simulation', serialWritten: false, arduinoAcknowledged: false, physicalConfirmed: false };
    }
    if (typeof portPath !== 'string' || !/^COM\d+$/i.test(portPath)) {
      throw new Error('Selecciona un puerto COM válido.');
    }
    const available = await listPorts();
    if (!available.some((item) => item.path.toLowerCase() === portPath.toLowerCase())) {
      throw new Error(`El puerto ${portPath} no está disponible.`);
    }

    const seq = sequence++ & 0xff;
    const frame = makeFrame(word, seq, metadata);
    const { SerialPort } = require('serialport');
    const selectedPort = new SerialPort({
      path: portPath,
      baudRate: Number(env.SERIAL_BAUD_RATE) || 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });
    port = selectedPort;
    try {
      await new Promise((resolve, reject) => selectedPort.open((error) => error ? reject(error) : resolve()));
      const ack = new Promise((resolve, reject) => {
        let received = Buffer.alloc(0);
        const timeout = setTimeout(
          () => reject(new Error('Tiempo de espera agotado: el Arduino no confirmó la trama.')),
          Number(env.SERIAL_ACK_TIMEOUT_MS) || 1500
        );
        selectedPort.on('data', (chunk) => {
          received = Buffer.concat([received, chunk]);
          const start = received.indexOf(START);
          const end = start >= 0 ? received.indexOf(END, start + 1) : -1;
          if (start >= 0 && end >= 0) {
            clearTimeout(timeout);
            try {
              parseAck(received.subarray(start, end + 1), seq);
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        });
        selectedPort.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      await new Promise((resolve, reject) => selectedPort.write(frame, (error) => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => selectedPort.drain((error) => error ? reject(error) : resolve()));
      await ack;
      return { mode: 'hardware', serialWritten: true, arduinoAcknowledged: true, physicalConfirmed: false };
    } catch (error) {
      logger.error('Fallo de comunicación serial:', error.message);
      throw new Error(`Fallo serial en ${portPath}: ${error.message}`);
    } finally {
      if (selectedPort.isOpen) {
        await new Promise((resolve) => selectedPort.close(() => resolve()));
      }
      if (port === selectedPort) port = undefined;
    }
  }

  return { mode, listPorts, sendWord };
}

module.exports = { createSerialService, crc16, makeFrame, parseAck };
