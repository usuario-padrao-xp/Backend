



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

// ==================== GET / ====================
// Lista registros de intrusos (com paginação)
router.get('/', async (req, res) => {
  try {
    const { limit, offset, page, userId, group } = req.query;
    
    let sql = 'SELECT * FROM intruders_log WHERE 1=1';
    const params = [];

    if (userId) {
      params.push(userId);
      sql += ` AND user_id = $${params.length}`;
    }

    if (group) {
      params.push(group);
      sql += ` AND user_group = $${params.length}`;
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
    
    // Contar total
    const countResult = await query('SELECT COUNT(*) as total FROM intruders_log');
    
    res.json({
      intruders: toCamel(result.rows),
      total: parseInt(countResult.rows[0].total)
    });
  } catch (err) {
    console.error('❌ Erro ao listar intrusos:', err.message);
    res.status(500).json({ error: 'Erro ao listar intrusos' });
  }
});

// ==================== POST / ====================
// Registra um novo intruso
router.post('/', async (req, res) => {
  try {
    const intruderData = req.body;
    
    // Registrar o log
    const columns = [
      'timestamp', 'page', 'user_name', 'user_id', 'user_group', 'user_country',
      'user_email', 'ip', 'browser', 'language', 'screen_resolution', 'user_agent'
    ];
    
    const values = [
      intruderData.timestamp || new Date().toISOString(),
      intruderData.page || 'N/D',
      intruderData.userName || intruderData.user_name || 'Visitante',
      intruderData.userId || intruderData.user_id || 'guest',
      intruderData.userGroup || intruderData.user_group || 'pt',
      intruderData.userCountry || intruderData.user_country || 'N/D',
      intruderData.userEmail || intruderData.user_email || 'N/D',
      intruderData.ip || 'N/D',
      intruderData.browser || 'N/D',
      intruderData.language || 'pt',
      intruderData.screenResolution || intruderData.screen_resolution || 'N/D',
      intruderData.userAgent || intruderData.user_agent || 'N/D'
    ];

    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO intruders_log (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      RETURNING id, timestamp, page, user_name, ip
    `;

    const result = await query(sql, values);
    
    // Limitar registros (manter apenas últimos 10000)
    const countResult = await query('SELECT COUNT(*) as count FROM intruders_log');
    if (parseInt(countResult.rows[0].count) > 10000) {
      await query(`
        DELETE FROM intruders_log 
        WHERE id NOT IN (
          SELECT id FROM intruders_log ORDER BY timestamp DESC LIMIT 10000
        )
      `);
    }

    res.status(201).json({ 
      success: true, 
      id: result.rows[0].id,
      message: 'Intruso registrado com sucesso'
    });
  } catch (err) {
    console.error('❌ Erro ao registrar intruso:', err.message);
    res.status(500).json({ error: 'Erro ao registrar intruso' });
  }
});

// ==================== DELETE /clean ====================
// Limpa registros antigos de intrusos
router.delete('/clean', async (req, res) => {
  try {
    const { days } = req.query;
    const daysToKeep = parseInt(days) || 0;
    
    if (daysToKeep === 0) {
      // Limpar tudo
      const countResult = await query('SELECT COUNT(*) as count FROM intruders_log');
      const count = parseInt(countResult.rows[0].count);
      await query('DELETE FROM intruders_log');
      
      return res.json({ 
        success: true, 
        message: `${count} registros de intrusos foram removidos`,
        deletedCount: count
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await query(
      'DELETE FROM intruders_log WHERE timestamp < $1 RETURNING id',
      [cutoffDate.toISOString()]
    );

    res.json({ 
      success: true, 
      message: `${result.rows.length} registros antigos foram removidos`,
      deletedCount: result.rows.length
    });
  } catch (err) {
    console.error('❌ Erro ao limpar intrusos:', err.message);
    res.status(500).json({ error: 'Erro ao limpar intrusos' });
  }
});

module.exports = router;

