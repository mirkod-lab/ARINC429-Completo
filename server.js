require('dotenv').config();

const express = require('express');
const path = require('path');
const { createPool } = require('./database/connection');
const { createInstrumentosRouter } = require('./routes/instrumentos');
const { createEnviosRouter } = require('./routes/envios');
const { createSerialService } = require('./services/serial');

const app = express();
const port = Number(process.env.PORT) || 3000;
const pool = createPool();
const serial = createSerialService();

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/estado', (req, res) => res.json({ serialMode: serial.mode() }));
app.get('/api/serial/puertos', async (req, res, next) => {
  try {
    res.json({ mode: serial.mode(), ports: await serial.listPorts() });
  } catch (error) {
    next(error);
  }
});
app.use('/api/instrumentos', createInstrumentosRouter(pool));
app.use('/api/envios', createEnviosRouter(pool, serial));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({
    error: status === 500 ? 'Error del servidor. Verifica MySQL y los registros del servidor.' : error.message
  });
});

const server = app.listen(port, () => {
  console.log(`ARINC 429 Lab disponible en http://localhost:${port} (serial: ${serial.mode()})`);
});

async function shutdown() {
  server.close();
  await pool.end();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
