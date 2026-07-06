
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
// Lista todas as notificações
router.get('/', async (req, res) => {
  try {
    const { targetGroup, targetCountry, targetUserId, type, limit, offset } = req.query;
    
    let sql = 'SELECT * FROM notifications WHERE 1=1';
    const params = [];

    if (targetGroup && targetGroup !== 'todos') {
      params.push(targetGroup);
      sql += ` AND target_group = $${params.length}`;
    }

    if (targetCountry && targetCountry !== 'todos') {
      params.push(targetCountry);
      sql += ` AND target_country = $${params.length}`;
    }

    if (targetUserId) {
      params.push(targetUserId);
      sql += ` AND target_user_id = $${params.length}`;
    }

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }

    sql += ' ORDER BY timestamp DESC';

    if (limit) {
      params.push(parseInt(limit));
      sql += ` LIMIT $${params.length}`;
    }

    if (offset) {
      params.push(parseInt(offset));
      sql += ` OFFSET $${params.length}`;
    }

    const result = await query(sql, params);
    res.json(toCamel(result.rows));
  } catch (err) {
    console.error('❌ Erro ao listar notificações:', err.message);
    res.status(500).json({ error: 'Erro ao listar notificações' });
  }
});

// ==================== POST / ====================
// Cria uma nova notificação
router.post('/', async (req, res) => {
  try {
    const notificationData = toSnake(req.body);
    
    if (!notificationData.title && !notificationData.message) {
      return res.status(400).json({ error: 'Título ou mensagem é obrigatório' });
    }

    // Se não tiver timestamp, usar agora
    if (!notificationData.timestamp) {
      notificationData.timestamp = new Date().toISOString();
    }

    const columns = Object.keys(notificationData);
    const values = Object.values(notificationData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO notifications (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await query(sql, values);
    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao criar notificação:', err.message);
    res.status(500).json({ error: 'Erro ao criar notificação' });
  }
});

// ==================== POST /broadcast ====================
// Envia uma notificação para todos os usuários ou grupo específico
router.post('/broadcast', async (req, res) => {
  try {
    const { type, title, message, content, targetGroup, targetCountry } = req.body;
    
    if (!title && !message) {
      return res.status(400).json({ error: 'Título ou mensagem é obrigatório' });
    }

    const notificationData = {
      type: type || 'broadcast',
      title: title || '',
      message: message || '',
      content: content || message || '',
      target_group: targetGroup || 'todos',
      target_country: targetCountry || 'todos',
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    const columns = Object.keys(notificationData);
    const values = Object.values(notificationData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO notifications (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const result = await query(sql, values);
    
    // Contar quantos usuários serão alcançados
    let countSql = 'SELECT COUNT(*) as count FROM users WHERE account_deleted = FALSE';
    const countParams = [];
    
    if (targetGroup && targetGroup !== 'todos') {
      countParams.push(targetGroup);
      countSql += ` AND "group" = $${countParams.length}`;
    }
    
    if (targetCountry && targetCountry !== 'todos') {
      countParams.push(targetCountry);
      countSql += ` AND country_name = $${countParams.length}`;
    }

    const countResult = await query(countSql, countParams);
    const reachCount = parseInt(countResult.rows[0].count);

    res.status(201).json({
      success: true,
      notification: toCamel(result.rows[0]),
      reachCount: reachCount,
      message: `Notificação enviada para ${reachCount} usuários`
    });
  } catch (err) {
    console.error('❌ Erro ao enviar broadcast:', err.message);
    res.status(500).json({ error: 'Erro ao enviar broadcast' });
  }
});

// ==================== DELETE /clean ====================
// Limpa notificações antigas
router.delete('/clean', async (req, res) => {
  try {
    const { days } = req.query;
    const daysToKeep = parseInt(days) || 7;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await query(
      'DELETE FROM notifications WHERE timestamp < $1 RETURNING id',
      [cutoffDate.toISOString()]
    );

    res.json({ 
      success: true, 
      message: `${result.rows.length} notificações antigas foram removidas`,
      deletedCount: result.rows.length
    });
  } catch (err) {
    console.error('❌ Erro ao limpar notificações:', err.message);
    res.status(500).json({ error: 'Erro ao limpar notificações' });
  }
});

module.exports = router;

