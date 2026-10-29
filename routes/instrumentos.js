const express = require('express');
const { generateWord } = require('../services/arinc429');

const INSTRUMENT_FIELDS = `id_instrumento, nombre, etiqueta_arinc, formato_datos, unidad,
  valor_minimo, valor_maximo, resolucion, parametros_arinc, parametros_tension`;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function numericValue(value, field) {
  const number = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
    ? Number(value)
    : NaN;
  if (!Number.isFinite(number)) invalid(`${field} debe ser un número válido.`);
  return number;
}

function jsonObject(value, field) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      invalid(`${field} debe contener JSON válido.`);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid(`${field} debe ser un objeto JSON.`);
  }
  return parsed;
}

function normalizeInstrument(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('El cuerpo debe ser un objeto JSON.');
  }
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const unidad = typeof body.unidad === 'string' ? body.unidad.trim() : '';
  if (!nombre || nombre.length > 120) invalid('La descripción es obligatoria y no puede superar 120 caracteres.');
  if (!unidad || unidad.length > 24) invalid('La unidad es obligatoria y no puede superar 24 caracteres.');

  const etiquetaArinc = numericValue(body.etiqueta_arinc, 'La etiqueta ARINC');
  if (!Number.isInteger(etiquetaArinc) || etiquetaArinc < 0 || etiquetaArinc > 255) {
    invalid('La etiqueta ARINC debe ser un entero entre 0 y 255.');
  }
  if (!['BNR', 'BCD'].includes(body.formato_datos)) {
    invalid('El formato de datos debe ser BNR o BCD.');
  }

  const valorMinimo = numericValue(body.valor_minimo, 'El valor mínimo');
  const valorMaximo = numericValue(body.valor_maximo, 'El valor máximo');
  const resolucion = numericValue(body.resolucion, 'La resolución');
  if (Math.abs(valorMinimo) >= 1e9 || Math.abs(valorMaximo) >= 1e9) {
    invalid('Los valores mínimo y máximo deben caber en DECIMAL(14,5).');
  }
  if (Math.abs(valorMinimo * 1e5 - Math.round(valorMinimo * 1e5)) > 1e-6
      || Math.abs(valorMaximo * 1e5 - Math.round(valorMaximo * 1e5)) > 1e-6) {
    invalid('Los valores mínimo y máximo admiten como máximo 5 decimales.');
  }
  if (valorMinimo >= valorMaximo) invalid('El valor mínimo debe ser menor que el máximo.');
  if (resolucion <= 0 || resolucion >= 1e6
      || Math.abs(resolucion * 1e8 - Math.round(resolucion * 1e8)) > 1e-6) {
    invalid('La resolución debe ser positiva y admitir como máximo 8 decimales.');
  }

  const parametrosArinc = jsonObject(body.parametros_arinc, 'Los parámetros ARINC');
  const parametrosTension = jsonObject(body.parametros_tension, 'Los parámetros de tensión');
  const instrument = {
    nombre,
    etiqueta_arinc: etiquetaArinc,
    formato_datos: body.formato_datos,
    unidad,
    valor_minimo: valorMinimo,
    valor_maximo: valorMaximo,
    resolucion,
    parametros_arinc: parametrosArinc,
    parametros_tension: parametrosTension
  };
  try {
    generateWord(instrument, valorMinimo);
    generateWord(instrument, valorMaximo);
  } catch (error) {
    invalid(`Configuración del instrumento no válida: ${error.message}`);
  }
  return instrument;
}

function createInstrumentosRouter(pool) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT ${INSTRUMENT_FIELDS} FROM instrumentos ORDER BY id_instrumento`
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const [rows] = await pool.execute(
        `SELECT ${INSTRUMENT_FIELDS} FROM instrumentos WHERE id_instrumento = ?`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'No se encontró el instrumento.' });
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const instrument = normalizeInstrument(req.body);
      const [result] = await pool.execute(
        `INSERT INTO instrumentos
         (nombre, etiqueta_arinc, formato_datos, unidad, valor_minimo, valor_maximo,
          resolucion, parametros_arinc, parametros_tension)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          instrument.nombre,
          instrument.etiqueta_arinc,
          instrument.formato_datos,
          instrument.unidad,
          instrument.valor_minimo,
          instrument.valor_maximo,
          instrument.resolucion,
          JSON.stringify(instrument.parametros_arinc),
          JSON.stringify(instrument.parametros_tension)
        ]
      );
      res.status(201).json({ id_instrumento: result.insertId, ...instrument });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const instrument = normalizeInstrument(req.body);
      const [result] = await pool.execute(
        `UPDATE instrumentos
         SET nombre = ?, etiqueta_arinc = ?, formato_datos = ?, unidad = ?,
             valor_minimo = ?, valor_maximo = ?, resolucion = ?,
             parametros_arinc = ?, parametros_tension = ?
         WHERE id_instrumento = ?`,
        [
          instrument.nombre,
          instrument.etiqueta_arinc,
          instrument.formato_datos,
          instrument.unidad,
          instrument.valor_minimo,
          instrument.valor_maximo,
          instrument.resolucion,
          JSON.stringify(instrument.parametros_arinc),
          JSON.stringify(instrument.parametros_tension),
          id
        ]
      );
      if (!result.affectedRows) {
        const [rows] = await pool.execute(
          'SELECT id_instrumento FROM instrumentos WHERE id_instrumento = ?',
          [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'No se encontró el instrumento.' });
      }
      res.json({ id_instrumento: id, ...instrument });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = validId(req.params.id);
      if (!id) return res.status(400).json({ error: 'El identificador no es válido.' });
      const [references] = await pool.execute(
        'SELECT id_envio FROM envios WHERE id_instrumento = ? LIMIT 1',
        [id]
      );
      if (references.length) {
        return res.status(409).json({
          error: 'No se puede eliminar el instrumento porque tiene envíos asociados.'
        });
      }
      const [result] = await pool.execute(
        'DELETE FROM instrumentos WHERE id_instrumento = ?',
        [id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'No se encontró el instrumento.' });
      res.json({ message: 'Instrumento eliminado.' });
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
        return res.status(409).json({
          error: 'No se puede eliminar el instrumento porque tiene envíos asociados.'
        });
      }
      next(error);
    }
  });

  return router;
}

module.exports = { createInstrumentosRouter };
