const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: { error: 'Muitas requisições. Tente novamente mais tarde.' }
});

// Middleware
app.use(cors({
  origin: ['https://aegisworks.netlify.app', 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Origin', 'X-Requested-With', 'X-Nonce', 'X-HMAC', 'X-Timestamp'],
  credentials: true
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(limiter);

// ==================== HEALTH CHECK ====================
app.get('/api/health', async (req, res) => {
  try {
    const { query } = require('./database');
    const result = await query('SELECT 1 as ok');
    res.json({
      status: 'healthy',
      database: result.rows[0].ok === 1 ? 'connected' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed / 1024 / 1024
    });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected', error: err.message });
  }
});

// ==================== ROTAS DA API ====================
app.use('/api/auth', require('./auth'));
app.use('/api/users', require('./users'));
app.use('/api/products', require('./products'));
app.use('/api/services', require('./services'));
app.use('/api/free-products', require('./free-products'));
app.use('/api/courses', require('./courses'));
app.use('/api/posts', require('./posts'));
app.use('/api/alerts', require('./alerts'));
app.use('/api/ads', require('./ads'));
app.use('/api/banners', require('./banners'));
app.use('/api/reviews', require('./reviews'));
app.use('/api/transactions', require('./transactions'));
app.use('/api/purchases', require('./purchases'));
app.use('/api/messages', require('./messages'));
app.use('/api/notifications', require('./notifications'));
app.use('/api/stats', require('./stats'));
app.use('/api/intruders', require('./intruders'));
app.use('/api/announcements', require('./announcements'));
app.use('/api/system-config', require('./system-config'));

// ==================== ERRO 404 ====================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado', path: req.originalUrl });
});

// ==================== TRATAMENTO DE ERRO GLOBAL ====================
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.message);
  if (err.stack) console.error(err.stack);
  res.status(500).json({ error: 'Erro interno do servidor', message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  🚀 Aegisworks API v1.0                  ║');
  console.log(`║  📍 Porta: ${PORT}                           ║`);
  console.log(`║  🏥 Health: http://localhost:${PORT}/api/health ║`);
  console.log('╚══════════════════════════════════════════╝');
});

module.exports = app;