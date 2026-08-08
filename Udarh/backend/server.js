require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason && reason.message ? reason.message : reason);
  if (reason && reason.stack) console.error(reason.stack.split('\n').slice(0, 4).join('\n'));
});

const express = require('express');
const cors = require('cors');

const routeRoutes = require('./routes/route');
const advisoryRoutes = require('./routes/advisory');
const aqiCache = require('./services/aqiCache');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'AirRoute Backend');
  next();
});

app.get('/health', (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  const keyOk = key && !key.startsWith('your_');
  res.json({
    status: 'ok',
    message: 'AirRoute Backend is running',
    aqiCacheReady: aqiCache.isReady(),
    aqiCacheLastUpdated: aqiCache.getLastUpdated(),
    aqiCacheCells: aqiCache.getCellCount(),
    googleApiKeyConfigured: !!keyOk,
    mode: keyOk ? 'LIVE' : 'DEMO/FALLBACK',
  });
});

app.use('/routes', routeRoutes);
app.use('/advisory', advisoryRoutes);

app.get('/aqi-grid', (req, res) => {
  const grid = aqiCache.getGrid();
  res.json({
    lastUpdated: aqiCache.getLastUpdated(),
    cellSizeMeters: aqiCache.getCellSize(),
    count: grid.length,
    grid,
  });
});

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} does not exist.`,
    validEndpoints: [
      'GET  /health',
      'GET  /aqi-grid',
      'POST /routes',
      'POST /routes/geocode',
      'GET  /routes/:routeId',
      'POST /advisory',
    ],
  });
});

app.use((err, req, res, next) => {
  console.error('[ERROR MIDDLEWARE]', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
  res.status(err.status || 500).json({
    error: err.code || 'Internal Server Error',
    message: err.message || 'Something went wrong on the server.',
  });
});

async function start() {
  try {
    await aqiCache.init();
  } catch (err) {
    console.warn('AQI cache init had issues, continuing anyway:', err.message);
  }

  app.listen(PORT, () => {
    const key = process.env.GOOGLE_MAPS_API_KEY || '';
    const keyOk = key && !key.startsWith('your_');
    console.log('================================================');
    console.log(`  🟢 AirRoute Backend  |  port ${PORT}`);
    console.log(`  Mode : ${keyOk ? 'LIVE (Google API key configured)' : 'DEMO (fallback AQI values)'}`);
    console.log(`  Cache: ${aqiCache.getCellCount()} cells · last refresh: ${aqiCache.getLastUpdated() ? new Date(aqiCache.getLastUpdated()).toLocaleTimeString() : 'n/a'}`);
    console.log('================================================');
    console.log(`  Health check  →  http://localhost:${PORT}/health`);
    console.log(`  AQI grid      →  http://localhost:${PORT}/aqi-grid`);
    console.log(`  POST /routes  →  http://localhost:${PORT}/routes`);
    console.log(`  POST /advisory → http://localhost:${PORT}/advisory`);
    console.log('================================================');
  });
}

start();
