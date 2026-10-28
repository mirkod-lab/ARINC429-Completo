const WORD_BITS = 32;
const PARITY_BIT = 32;

function assertInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
}

function setBit(word, position, value) {
  const mask = 1n << BigInt(position - 1);
  return value ? word | mask : word & ~mask;
}

function writeField(word, startBit, length, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** length) {
    throw new Error('El valor codificado no cabe en el campo ARINC configurado.');
  }
  let result = word;
  for (let offset = 0; offset < length; offset += 1) {
    result = setBit(result, startBit + offset, Math.floor(value / (2 ** offset)) % 2);
  }
  return result;
}

function getParameters(instrument) {
  const parameters = typeof instrument.parametros_arinc === 'string'
    ? JSON.parse(instrument.parametros_arinc)
    : instrument.parametros_arinc;
  if (!parameters || typeof parameters !== 'object') {
    throw new Error('El instrumento no tiene parámetros ARINC válidos.');
  }
  return parameters;
}

function encodeData(instrument, value, parameters) {
  if (instrument.formato_datos === 'BNR') {
    const start = parameters.dataStartBit;
    const length = parameters.dataBitLength;
    assertInteger(start, 'dataStartBit', 1, 31);
    assertInteger(length, 'dataBitLength', 1, 31);
    if (start + length - 1 > 29) throw new Error('El campo BNR debe quedar entre los bits 1 y 29.');
    const resolution = Number(instrument.resolucion);
    const scaled = value / resolution;
    const quantized = Math.round(scaled);
    if (Math.abs(scaled - quantized) > 1e-7) {
      throw new Error(`El valor debe ser múltiplo de la resolución ${resolution}.`);
    }

    if (parameters.encoding === 'twos-complement') {
      const min = -(2 ** (length - 1));
      const max = (2 ** (length - 1)) - 1;
      if (quantized < min || quantized > max) throw new Error('El valor excede la capacidad del campo BNR.');
      return { start, length, raw: quantized < 0 ? (2 ** length) + quantized : quantized };
    }
    if (parameters.encoding === 'unsigned') {
      if (quantized < 0) throw new Error('El BNR sin signo no admite valores negativos.');
      return { start, length, raw: quantized };
    }
    throw new Error('Codificación BNR no admitida. Use "twos-complement" o "unsigned".');
  }

  if (instrument.formato_datos === 'BCD') {
    const start = parameters.bcdStartBit;
    const digitCount = parameters.digitCount;
    assertInteger(start, 'bcdStartBit', 1, 29);
    assertInteger(digitCount, 'digitCount', 1, 7);
    const positions = parameters.digitBitPositions;
    if (!Array.isArray(positions) || positions.length !== digitCount) {
      throw new Error('BCD requiere una posición de inicio para cada dígito.');
    }
    const resolution = Number(instrument.resolucion);
    const scaled = value / resolution;
    const integer = Math.round(scaled);
    if (Math.abs(scaled - integer) > 1e-7 || integer < 0) {
      throw new Error(`BCD requiere un múltiplo entero no negativo de ${resolution}.`);
    }
    if (String(integer).length > digitCount) throw new Error('El valor no cabe en los dígitos BCD configurados.');
    return { digits: String(integer).padStart(digitCount, '0'), positions, digitCount };
  }

  throw new Error(`Formato de datos no admitido: ${instrument.formato_datos}`);
}

function generateWord(instrument, value) {
  const min = Number(instrument.valor_minimo);
  const max = Number(instrument.valor_maximo);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`El valor debe estar entre ${min} y ${max} ${instrument.unidad}.`);
  }
  const parameters = getParameters(instrument);
  const label = Number(instrument.etiqueta_arinc);
  const sdi = Number(parameters.sdi ?? 0);
  const ssm = Number(parameters.ssm ?? 0);
  assertInteger(label, 'etiqueta_arinc', 0, 255);
  assertInteger(sdi, 'sdi', 0, 3);
  assertInteger(ssm, 'ssm', 0, 3);

  let word = 0n;
  const labelOrder = parameters.labelBitOrder ?? 'reverse';
  if (labelOrder !== 'reverse' && labelOrder !== 'normal') {
    throw new Error('labelBitOrder debe ser "reverse" o "normal".');
  }
  for (let i = 0; i < 8; i += 1) {
    const bit = (label >> i) & 1;
    word = setBit(word, i + 1, labelOrder === 'reverse' ? bit : (label >> (7 - i)) & 1);
  }
  word = writeField(word, 9, 2, sdi);

  const encoded = encodeData(instrument, value, parameters);
  if (instrument.formato_datos === 'BNR') {
    word = writeField(word, encoded.start, encoded.length, encoded.raw);
  } else {
    for (let i = 0; i < encoded.digitCount; i += 1) {
      const position = Number(encoded.positions[i]);
      assertInteger(position, `digitBitPositions[${i}]`, 11, 29);
      if (position + 3 > 29) throw new Error('Cada dígito BCD debe quedar entre los bits 11 y 29.');
      word = writeField(word, position, 4, Number(encoded.digits[encoded.digitCount - 1 - i]));
    }
  }
  word = writeField(word, 30, 2, ssm);

  let ones = 0;
  for (let bit = 0; bit < 31; bit += 1) ones += Number((word >> BigInt(bit)) & 1n);
  word = setBit(word, PARITY_BIT, ones % 2 === 0 ? 1 : 0);
  const numeric = Number(word);
  return {
    word: numeric,
    binary: word.toString(2).padStart(WORD_BITS, '0'),
    hexadecimal: `0x${word.toString(16).toUpperCase().padStart(8, '0')}`,
    bytesLittleEndian: [0, 1, 2, 3].map((i) => Number((word >> BigInt(i * 8)) & 0xffn)),
    oddParity: [...word.toString(2)].filter((bit) => bit === '1').length % 2 === 1
  };
}

function simulateVoltageLevels(binary) {
  if (typeof binary !== 'string' || !/^[01]{32}$/.test(binary)) {
    throw new Error('La simulación de tensión requiere una palabra binaria de 32 bits.');
  }
  return [...binary].map((bit, index) => ({
    bitPosition: WORD_BITS - index,
    bit: Number(bit),
    voltage: bit === '1' ? 12 : -12
  }));
}

module.exports = { generateWord, simulateVoltageLevels };
