const express = require('express');
const { generateWord, simulateVoltageLevels } = require('../services/arinc429');

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parsePayload(body) {
  const idInstrumento = validId(body.id_instrumento);
  const rawValue = body.valor;
  const valor = typeof rawValue === 'number' || (typeof rawValue === 'string' && rawValue.trim() !== '')
    ? Number(rawValue)
    : NaN;
  if (!idInstrumento || !Number.isFinite(valor)) {
    throw Object.assign(new Error('Instrumento y valor numérico son obligatorios.'), { status: 400 });
  }
  return { idInstrumento, valor };
}

function createEnviosRouter(pool, serial) {
  const router = express.Router();

  async function instrument(id) {
    const [rows] = await pool.execute('SELECT * FROM instrumentos WHERE id_instrumento = ?', [id]);
    if (!rows.length) throw Object.assign(new Error('No se encontró el instrumento.'), { status: 404 });
    return rows[0];
  }

  async function prepare(body) {
    const { idInstrumento, valor } = parsePayload(body);
    const selected = await instrument(idInstrumento);
    let encoded;
    try {
      encoded = generateWord(selected, valor);
    } catch (error) {
      error.status = 400;
      throw error;
    }
    return { idInstrumento, valor, encoded };
  }

  function validateDate(value, name) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw Object.assign(new Error(`El filtro ${name} debe tener formato YYYY-MM-DD.`), { status: 400 });
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw Object.assign(new Error(`El filtro ${name} no es una fecha válida.`), { status: 400 });
    }
    return value;
  }

  router.post('/preview', async (req, res, next) => {
    try {
      const { valor, encoded } = await prepare(req.body);
      res.json({ valor, ...encoded, simulatedVoltages: simulateVoltageLevels(encoded.binary) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const conditions = [];
      const values = [];
      if (req.query.id_instrumento !== undefined) {
        const id = validId(req.query.id_instrumento);
        if (!id) return res.status(400).json({ error: 'Filtro de instrumento no válido.' });
        conditions.push('e.id_instrumento = ?');
        values.push(id);
      }
      if (req.query.estado !== undefined) {
        if (!['pendiente', 'procesado', 'enviado', 'error'].includes(req.query.estado)) {
          return res.status(400).json({ error: 'Filtro de estado no válido.' });
        }
        conditions.push('e.estado = ?');
        values.push(req.query.estado);
      }
      if (req.query.desde) {
        conditions.push('e.fecha_hora >= ?');
        values.push(`${validateDate(req.query.desde, 'desde')} 00:00:00`);
      }
      if (req.query.hasta) {
        conditions.push('e.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)');
        values.push(`${validateDate(req.query.hasta, 'hasta')} 00:00:00`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.execute(
        `SELECT e.*, i.nombre AS instrumento, i.unidad
         FROM envios e JOIN instrumentos i ON i.id_instrumento = e.id_instrumento
         ${where} ORDER BY e.fecha_hora DESC, e.id_envio DESC LIMIT 500`,
        values
      );
      res.json(rows.map((row) => ({
        ...row,
        simulatedVoltages: simulateVoltageLevels(row.palabra_binaria)
      })));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const [rows] = await pool.execute(
        `SELECT e.*, i.nombre AS instrumento, i.unidad, i.formato_datos, i.etiqueta_arinc
         FROM envios e JOIN instrumentos i ON i.id_instrumento = e.id_instrumento
         WHERE e.id_envio = ?`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'No se encontró el envío.' });
      res.json({
        ...rows[0],
        simulatedVoltages: simulateVoltageLevels(rows[0].palabra_binaria)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { idInstrumento, valor, encoded } = await prepare(req.body);
      const [result] = await pool.execute(
        `INSERT INTO envios
         (id_instrumento, valor, palabra_binaria, palabra_hexadecimal, estado)
         VALUES (?, ?, ?, ?, 'pendiente')`,
        [idInstrumento, valor, encoded.binary, encoded.hexadecimal.slice(2)]
      );
      res.status(201).json({
        id_envio: result.insertId,
        valor,
        ...encoded,
        estado: 'pendiente',
        simulatedVoltages: simulateVoltageLevels(encoded.binary),
        message: 'Envío guardado; aún no se ha transmitido.'
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const [existing] = await pool.execute('SELECT estado FROM envios WHERE id_envio = ?', [id]);
      if (!existing.length) return res.status(404).json({ error: 'No se encontró el envío.' });
      if (existing[0].estado === 'enviado') {
        return res.status(409).json({ error: 'Un envío aceptado por Arduino no se puede editar.' });
      }
      const { idInstrumento, valor, encoded } = await prepare(req.body);
      await pool.execute(
        `UPDATE envios SET id_instrumento = ?, valor = ?, palabra_binaria = ?,
         palabra_hexadecimal = ?, estado = 'pendiente', detalle_error = NULL WHERE id_envio = ?`,
        [idInstrumento, valor, encoded.binary, encoded.hexadecimal.slice(2), id]
      );
      res.json({
        id_envio: id,
        valor,
        ...encoded,
        estado: 'pendiente',
        simulatedVoltages: simulateVoltageLevels(encoded.binary)
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const [result] = await pool.execute('DELETE FROM envios WHERE id_envio = ?', [id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'No se encontró el envío.' });
      res.json({ message: 'Envío eliminado.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/ejecutar', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const [rows] = await pool.execute('SELECT * FROM envios WHERE id_envio = ?', [id]);
      if (!rows.length) return res.status(404).json({ error: 'No se encontró el envío.' });
      const envio = rows[0];
      if (envio.estado === 'enviado') {
        return res.status(409).json({ error: 'Este envío ya fue aceptado por Arduino.' });
      }
      try {
        const outcome = await serial.sendWord(Number.parseInt(envio.palabra_hexadecimal, 16), req.body.port);
        if (outcome.mode === 'simulation') {
          await pool.execute(
            `UPDATE envios SET estado = 'procesado',
             detalle_error = 'SIMULACIÓN: no se envió dato al Arduino ni se confirmó salida física.' WHERE id_envio = ?`,
            [id]
          );
          return res.json({
            id_envio: id,
            estado: 'procesado',
            palabra_binaria: envio.palabra_binaria,
            palabra_hexadecimal: envio.palabra_hexadecimal,
            simulatedVoltages: simulateVoltageLevels(envio.palabra_binaria),
            outcome,
            message: 'Simulación completada: se muestra el mapeo didáctico 1 → +12 V y 0 → −12 V. No hubo transmisión serial ni física.'
          });
        }
        await pool.execute(
          `UPDATE envios SET estado = 'enviado',
           detalle_error = 'Arduino confirmó recepción serial; salida física A/B no verificada.' WHERE id_envio = ?`,
          [id]
        );
        return res.json({
          id_envio: id,
          estado: 'enviado',
          outcome,
          message: 'Arduino confirmó la recepción serial. No es una confirmación de la salida ARINC física.'
        });
      } catch (error) {
        await pool.execute(
          `UPDATE envios SET estado = 'error', detalle_error = ? WHERE id_envio = ?`,
          [error.message.slice(0, 4000), id]
        );
        error.status = 502;
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });
  return router;
}

module.exports = { createEnviosRouter };
