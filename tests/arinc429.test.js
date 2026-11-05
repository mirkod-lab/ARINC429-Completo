const test = require('node:test');
const assert = require('node:assert/strict');
const { generateWord, simulateVoltageLevels } = require('../services/arinc429');
const { makeFrame, crc16, parseAck } = require('../services/serial');

const bnr = {
  etiqueta_arinc: 0,
  formato_datos: 'BNR',
  unidad: 'u',
  valor_minimo: -10,
  valor_maximo: 10,
  resolucion: 1,
  parametros_arinc: {
    sdi: 1,
    ssm: 0,
    dataStartBit: 11,
    dataBitLength: 19,
    encoding: 'twos-complement',
    labelBitOrder: 'reverse'
  }
};

test('crea una palabra de 32 bits con paridad impar', () => {
  const result = generateWord(bnr, 5);
  assert.equal(result.binary.length, 32);
  assert.match(result.hexadecimal, /^0x[0-9A-F]{8}$/);
  assert.equal(result.oddParity, true);
  assert.equal([...result.binary].filter((bit) => bit === '1').length % 2, 1);
  assert.deepEqual(result.bytesLittleEndian.length, 4);
});

test('codifica BNR negativo en complemento a dos', () => {
  const positive = generateWord(bnr, 3).word;
  const negative = generateWord(bnr, -3).word;
  assert.notEqual(positive, negative);
  assert.equal(generateWord(bnr, -10).oddParity, true);
});

test('rechaza valores fuera de rango y valores no representables por resolución', () => {
  assert.throws(() => generateWord(bnr, 11), /entre -10 y 10/);
  assert.throws(() => generateWord(bnr, 1.5), /múltiplo de la resolución/);
});

test('codifica dígitos BCD configurables y rechaza exceso de dígitos', () => {
  const bcd = {
    ...bnr,
    formato_datos: 'BCD',
    valor_minimo: 0,
    valor_maximo: 999,
    parametros_arinc: {
      sdi: 0, ssm: 0, bcdStartBit: 11, digitCount: 3,
      digitBitPositions: [11, 15, 19], labelBitOrder: 'reverse'
    }
  };
  assert.equal(generateWord(bcd, 507).binary.length, 32);
  assert.equal(generateWord(bcd, 507).oddParity, true);
  assert.throws(() => generateWord(bcd, 1000), /entre 0 y 999/);
});

test('simula los 32 bits con mapeo didáctico 1 a +12 V y 0 a -12 V', () => {
  const levels = simulateVoltageLevels('1'.padEnd(32, '0'));
  assert.equal(levels.length, 32);
  assert.deepEqual(levels[0], { bitPosition: 32, bit: 1, voltage: 12 });
  assert.deepEqual(levels[1], { bitPosition: 31, bit: 0, voltage: -12 });
  assert.deepEqual(levels.at(-1), { bitPosition: 1, bit: 0, voltage: -12 });
  assert.throws(() => simulateVoltageLevels('101'), /32 bits/);
});

test('crea una trama serial de 11 bytes con palabra little-endian y CRC correcto', () => {
  const frame = makeFrame(0x12345678, 9);
  assert.equal(frame.length, 11);
  assert.deepEqual([...frame.subarray(4, 8)], [0x78, 0x56, 0x34, 0x12]);
  assert.equal(frame[0], 0x02);
  assert.equal(frame[10], 0x03);
  assert.equal(frame.readUInt16LE(8), crc16(frame.subarray(1, 8)));
});

test('incluye instrumento, valor y unidad en una trama serial extendida', () => {
  const frame = makeFrame(0x12345678, 9, {
    instrument: 'Velocidad aérea',
    value: 123.5,
    unit: 'km/h'
  });
  assert.equal(frame[0], 0x02);
  assert.equal(frame[1], 0x01);
  assert.equal(frame[2], 0x02);
  assert.equal(frame.readUInt32LE(4), 0x12345678);
  assert.equal(frame.length, 70);
  assert.equal(frame[8], Buffer.byteLength('Velocidad aerea'));
  assert.equal(frame.subarray(9, 9 + frame[8]).toString(), 'Velocidad aerea');
  const unitLengthIndex = 33;
  assert.equal(frame[unitLengthIndex], 4);
  assert.equal(frame.subarray(unitLengthIndex + 1, unitLengthIndex + 5).toString(), 'km/h');
  const valueLengthIndex = 46;
  assert.equal(frame[valueLengthIndex], 5);
  assert.equal(frame.subarray(valueLengthIndex + 1, valueLengthIndex + 6).toString(), '123.5');
  assert.equal(frame.readUInt16LE(frame.length - 3), crc16(frame.subarray(1, frame.length - 3)));
  assert.equal(frame.at(-1), 0x03);
  assert.throws(() => makeFrame(1, 0, {
    instrument: 'x'.repeat(25),
    value: 1,
    unit: ''
  }), /instrumento/);
});

test('acepta ACK íntegro y rechaza ACK de otra secuencia', () => {
  const ack = Buffer.from([0x02, 1, 0x81, 5, 0, 0, 0x03]);
  ack.writeUInt16LE(crc16(ack.subarray(1, 4)), 4);
  assert.equal(parseAck(ack, 5), true);
  assert.throws(() => parseAck(ack, 6), /secuencia esperados/);
});
