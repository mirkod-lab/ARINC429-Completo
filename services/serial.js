const START = 0x02;
const END = 0x03;
const VERSION = 1;
const COMMAND_WORD = 0x01;

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

function makeFrame(word, sequence) {
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

  async function sendWord(word, portPath) {
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
    const seq = sequence++ & 0xff;
    const frame = makeFrame(word, seq);
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
