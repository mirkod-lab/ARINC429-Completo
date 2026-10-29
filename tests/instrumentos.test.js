const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createEnviosRouter } = require('../routes/envios');
const { createInstrumentosRouter } = require('../routes/instrumentos');

function createPoolMock() {
  const instruments = new Map();
  const sends = new Map();
  let nextInstrumentId = 1;
  let nextSendId = 1;

  return {
    instruments,
    sends,
    async execute(sql, values = []) {
      const statement = sql.replace(/\s+/g, ' ').trim();
      if (statement.includes('FROM instrumentos ORDER BY id_instrumento')) {
        return [[...instruments.values()].sort((a, b) => a.id_instrumento - b.id_instrumento)];
      }
      if (statement.startsWith('SELECT ') && statement.includes('FROM instrumentos WHERE id_instrumento = ?')) {
        const instrument = instruments.get(Number(values[0]));
        return [instrument ? [{ ...instrument }] : []];
      }
      if (statement.startsWith('INSERT INTO instrumentos')) {
        const id = nextInstrumentId++;
        const [nombre, etiqueta, formato, unidad, minimo, maximo, resolucion, arinc, tension] = values;
        const instrument = {
          id_instrumento: id, nombre, etiqueta_arinc: etiqueta, formato_datos: formato, unidad,
          valor_minimo: minimo, valor_maximo: maximo, resolucion,
          parametros_arinc: JSON.parse(arinc), parametros_tension: JSON.parse(tension)
        };
        instruments.set(id, instrument);
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (statement.startsWith('UPDATE instrumentos')) {
        const [nombre, etiqueta, formato, unidad, minimo, maximo, resolucion, arinc, tension, id] = values;
        if (!instruments.has(Number(id))) return [{ affectedRows: 0 }];
        instruments.set(Number(id), {
          id_instrumento: Number(id), nombre, etiqueta_arinc: etiqueta, formato_datos: formato, unidad,
          valor_minimo: minimo, valor_maximo: maximo, resolucion,
          parametros_arinc: JSON.parse(arinc), parametros_tension: JSON.parse(tension)
        });
        return [{ affectedRows: 1 }];
      }
      if (statement.startsWith('SELECT id_envio FROM envios WHERE id_instrumento = ?')) {
        return [[...sends.values()].filter((send) => send.id_instrumento === Number(values[0])).slice(0, 1)];
      }
      if (statement.startsWith('DELETE FROM instrumentos')) {
        const deleted = instruments.delete(Number(values[0]));
        return [{ affectedRows: Number(deleted) }];
      }
      if (statement.startsWith('INSERT INTO envios')) {
        const [idInstrumento, valor, binary, hexadecimal] = values;
        const id = nextSendId++;
        sends.set(id, {
          id_envio: id,
          id_instrumento: idInstrumento,
          valor,
          palabra_binaria: binary,
          palabra_hexadecimal: hexadecimal,
          fecha_hora: new Date(),
          estado: 'pendiente',
          detalle_error: null
        });
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (statement.includes('FROM envios e JOIN instrumentos i')) {
        const rows = [...sends.values()].map((send) => {
          const instrument = instruments.get(send.id_instrumento);
          return {
            ...send,
            instrumento: instrument.nombre,
            unidad: instrument.unidad
          };
        });
        return [rows];
      }
      if (statement.startsWith('DELETE FROM envios')) {
        const deleted = sends.delete(Number(values[0]));
        return [{ affectedRows: Number(deleted) }];
      }
      throw new Error(`Consulta no contemplada en el mock: ${statement}`);
    }
  };
}

const instrumentPayload = {
  nombre: 'Indicador de prueba',
  etiqueta_arinc: 9,
  formato_datos: 'BNR',
  unidad: 'u',
  valor_minimo: 0,
  valor_maximo: 100,
  resolucion: 1,
  parametros_arinc: {
    sdi: 0,
    ssm: 0,
    dataStartBit: 11,
    dataBitLength: 19,
    encoding: 'unsigned',
    labelBitOrder: 'reverse'
  },
  parametros_tension: { status: 'Prueba' }
};

test('CRUD de instrumentos, validaciones y relación con envíos', async (t) => {
  const pool = createPoolMock();
  const app = express();
  app.use(express.json());
  app.use('/api/instrumentos', createInstrumentosRouter(pool));
  app.use('/api/envios', createEnviosRouter(pool, { sendWord: async () => ({ mode: 'simulation' }) }));
  app.use((error, req, res, next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    res.status(status).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    return { status: response.status, body: await response.json() };
  }

  assert.deepEqual((await request('/api/instrumentos')).body, []);
  assert.equal((await request('/api/instrumentos', {
    method: 'POST',
    body: { ...instrumentPayload, etiqueta_arinc: 256 }
  })).status, 400);
  assert.equal((await request('/api/instrumentos', {
    method: 'POST',
    body: { ...instrumentPayload, parametros_arinc: '{' }
  })).status, 400);

  const created = await request('/api/instrumentos', { method: 'POST', body: instrumentPayload });
  assert.equal(created.status, 201);
  const id = created.body.id_instrumento;
  assert.equal(created.body.nombre, instrumentPayload.nombre);
  assert.equal((await request('/api/instrumentos')).body.length, 1);
  assert.equal((await request(`/api/instrumentos/${id}`)).body.nombre, instrumentPayload.nombre);
  assert.equal((await request('/api/instrumentos/no-es-id')).status, 400);
  assert.equal((await request('/api/instrumentos/999')).status, 404);

  const updated = await request(`/api/instrumentos/${id}`, {
    method: 'PUT',
    body: { ...instrumentPayload, nombre: 'Indicador actualizado' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.nombre, 'Indicador actualizado');
  assert.equal((await request('/api/instrumentos/999', {
    method: 'PUT',
    body: instrumentPayload
  })).status, 404);
  assert.equal((await request(`/api/instrumentos/${id}`, {
    method: 'PUT',
    body: { ...instrumentPayload, valor_minimo: 10, valor_maximo: 5 }
  })).status, 400);

  const envio = await request('/api/envios', {
    method: 'POST',
    body: { id_instrumento: id, valor: 10 }
  });
  assert.equal(envio.status, 201);
  assert.equal((await request('/api/envios')).body[0].instrumento, 'Indicador actualizado');
  assert.equal((await request('/api/envios', {
    method: 'POST',
    body: { id_instrumento: 999, valor: 10 }
  })).status, 404);
  assert.equal((await request('/api/envios', {
    method: 'POST',
    body: { id_instrumento: id, valor: 101 }
  })).status, 400);
  assert.equal((await request(`/api/instrumentos/${id}`, { method: 'DELETE' })).status, 409);

  assert.equal((await request(`/api/envios/${envio.body.id_envio}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/instrumentos/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/instrumentos/${id}`)).status, 404);
  assert.equal((await request(`/api/instrumentos/${id}`, { method: 'DELETE' })).status, 404);
});
