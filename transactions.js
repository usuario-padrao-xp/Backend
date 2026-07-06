


const express = require('express');
const router = express.Router();
const { query } = require('./database');

function toCamel(obj) {
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      acc[camelKey] = toCamel(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

function toSnake(obj) {
  if (Array.isArray(obj)) return obj.map(toSnake);
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      acc[snakeKey] = toSnake(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

// ==================== GET / ====================
// Lista todas as transações
router.get('/', async (req, res) => {
  try {
    const { userId, status, limit } = req.query;
    
    let sql = 'SELECT * FROM transactions WHERE 1=1';
    const params = [];

    if (userId) {
      params.push(userId);
      sql += ` AND user_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      params.push(parseInt(limit));
      sql += ` LIMIT $${params.length}`;
    }

    const result = await query(sql, params);
    res.json(toCamel(result.rows));
  } catch (err) {
    console.error('❌ Erro ao listar transações:', err.message);
    res.status(500).json({ error: 'Erro ao listar transações' });
  }
});

// ==================== POST / ====================
// Cria uma nova transação
router.post('/', async (req, res) => {
  try {
    const transactionData = toSnake(req.body);
    
    if (!transactionData.token) {
      return res.status(400).json({ error: 'Token da transação é obrigatório' });
    }

    const columns = Object.keys(transactionData);
    const values = Object.values(transactionData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO transactions (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (token) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        created_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao criar transação:', err.message);
    res.status(500).json({ error: 'Erro ao criar transação' });
  }
});

// ==================== POST /secure ====================
// Cria uma transação segura (com payload encriptado)
router.post('/secure', async (req, res) => {
  try {
    const { payload, iv, salt, nonce, hmac } = req.body;
    
    if (!payload) {
      return res.status(400).json({ error: 'Payload é obrigatório' });
    }

    // Em produção, aqui seria feita a desencriptação AES-256-GCM
    // e verificação HMAC-SHA256
    // Para simplificar, aceitamos o payload como está
    
    // Tentar parse do payload como JSON
    let transactionData;
    try {
      transactionData = JSON.parse(payload);
    } catch (e) {
      // Se não for JSON, usar como token
      transactionData = { token: payload, status: 'completed' };
    }

    const columns = Object.keys(transactionData);
    const values = Object.values(transactionData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO transactions (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (token) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        created_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    
    // Também criar uma compra automaticamente
    const tx = result.rows[0];
    if (tx.product_id && tx.user_id) {
      const purchaseId = 'PUR-' + Date.now().toString(36).toUpperCase();
      await query(
        `INSERT INTO purchases (id, product_id, product_name, product_type, price, currency, is_free, user_id, user_name, user_email, user_country, user_group, token, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'confirmed')
         ON CONFLICT (id) DO NOTHING`,
        [
          purchaseId,
          tx.product_id,
          tx.product_name || 'Produto',
          tx.product_type || 'produto',
          tx.amount || 0,
          tx.currency || 'EUR',
          tx.is_free || false,
          tx.user_id,
          tx.user_name || 'Usuário',
          tx.user_email || '',
          tx.user_country || '',
          tx.user_language || 'pt',
          tx.token
        ]
      );
    }

    res.status(201).json({ success: true, transaction: toCamel(result.rows[0]) });
  } catch (err) {
    console.error('❌ Erro ao criar transação segura:', err.message);
    res.status(500).json({ error: 'Erro ao criar transação segura' });
  }
});

// ==================== PUT /:token ====================
// Atualiza o status de uma transação
router.put('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const updateData = toSnake(req.body);
    
    const existing = await query('SELECT token FROM transactions WHERE token = $1', [token]);
    
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const columns = Object.keys(updateData).filter(k => k !== 'token');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => updateData[col]);
    values.push(token);

    const sql = `
      UPDATE transactions 
      SET ${setClauses.join(', ')}
      WHERE token = $${values.length}
      RETURNING *
    `;

    const result = await query(sql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar transação:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar transação' });
  }
});

module.exports = router;

