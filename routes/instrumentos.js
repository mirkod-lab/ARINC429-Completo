const express = require('express');

function createInstrumentosRouter(pool) {
  const router = express.Router();
  router.get('/', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT id_instrumento, nombre, etiqueta_arinc, formato_datos, unidad,
                valor_minimo, valor_maximo, resolucion, parametros_arinc, parametros_tension
         FROM instrumentos ORDER BY id_instrumento`
      );
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });
  return router;
}

module.exports = { createInstrumentosRouter };
