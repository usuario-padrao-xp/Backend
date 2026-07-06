
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
// Lista todos os alertas ativos
router.get('/', async (req, res) => {
  try {
    const { group, active } = req.query;
    
    let sql = 'SELECT * FROM alerts WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (active === 'true') {
      sql += ' AND active = TRUE';
    } else if (active === 'false') {
      sql += ' AND active = FALSE';
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    
    // Parse JSONB fields
    const parsed = result.rows.map(row => ({
      ...row,
      pages: typeof row.pages === 'string' ? JSON.parse(row.pages) : row.pages,
      buttons: typeof row.buttons === 'string' ? JSON.parse(row.buttons) : row.buttons,
    }));

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao listar alertas:', err.message);
    res.status(500).json({ error: 'Erro ao listar alertas' });
  }
});

// ==================== POST / ====================
// Cria um novo alerta
router.post('/', async (req, res) => {
  try {
    const alertData = toSnake(req.body);
    
    if (!alertData.content || !alertData.id) {
      return res.status(400).json({ error: 'Conteúdo e ID são obrigatórios' });
    }

    // Serializar JSONB fields
    if (alertData.pages && typeof alertData.pages === 'object') {
      alertData.pages = JSON.stringify(alertData.pages);
    }
    if (alertData.buttons && typeof alertData.buttons === 'object') {
      alertData.buttons = JSON.stringify(alertData.buttons);
    }

    const columns = Object.keys(alertData);
    const values = Object.values(alertData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO alerts (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        updated_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    
    const row = result.rows[0];
    const parsed = {
      ...row,
      pages: typeof row.pages === 'string' ? JSON.parse(row.pages) : row.pages,
      buttons: typeof row.buttons === 'string' ? JSON.parse(row.buttons) : row.buttons,
    };

    res.status(201).json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao criar alerta:', err.message);
    res.status(500).json({ error: 'Erro ao criar alerta' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um alerta
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const alertData = toSnake(req.body);
    
    const existingAlert = await query('SELECT id FROM alerts WHERE id = $1', [id]);

    if (existingAlert.rows.length === 0) {
      const columns = Object.keys(alertData);
      const values = Object.values(alertData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      if (alertData.pages && typeof alertData.pages === 'object') {
        alertData.pages = JSON.stringify(alertData.pages);
      }
      if (alertData.buttons && typeof alertData.buttons === 'object') {
        alertData.buttons = JSON.stringify(alertData.buttons);
      }

      const insertSql = `INSERT INTO alerts (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(alertData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(alertData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    if (alertData.pages && typeof alertData.pages === 'object') {
      alertData.pages = JSON.stringify(alertData.pages);
    }
    if (alertData.buttons && typeof alertData.buttons === 'object') {
      alertData.buttons = JSON.stringify(alertData.buttons);
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => alertData[col]);
    values.push(id);

    const updateSql = `
      UPDATE alerts 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar alerta:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar alerta' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um alerta
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM alerts WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alerta não encontrado' });
    }

    // Também limpar dismissed_alerts
    await query('DELETE FROM dismissed_alerts WHERE alert_id = $1', [id]);

    res.json({ 
      success: true, 
      message: `Alerta "${result.rows[0].title || 'sem título'}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar alerta:', err.message);
    res.status(500).json({ error: 'Erro ao deletar alerta' });
  }
});

// ==================== POST /:id/dismiss ====================
// Marca um alerta como dispensado por um usuário
router.post('/:id/dismiss', async (req, res) => {
  try {
    const { id: alertId } = req.params;
    const { userId, dismissUntil } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    const dismissTime = dismissUntil || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await query(
      `INSERT INTO dismissed_alerts (user_id, alert_id, dismiss_until) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, alert_id) 
       DO UPDATE SET dismiss_until = $3`,
      [userId, alertId, dismissTime]
    );

    // Incrementar views do alerta
    await query('UPDATE alerts SET views = views + 1 WHERE id = $1', [alertId]);

    res.json({ success: true, message: 'Alerta dispensado com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao dispensar alerta:', err.message);
    res.status(500).json({ error: 'Erro ao dispensar alerta' });
  }
});

// ==================== GET /dismissed/:userId ====================
// Lista alertas dispensados por um usuário
router.get('/dismissed/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await query(
      'SELECT alert_id, dismiss_until FROM dismissed_alerts WHERE user_id = $1 AND dismiss_until > NOW()',
      [userId]
    );

    res.json(toCamel(result.rows));
  } catch (err) {
    console.error('❌ Erro ao buscar alertas dispensados:', err.message);
    res.status(500).json({ error: 'Erro ao buscar alertas dispensados' });
  }
});

// ==================== PUT /:id/view ====================
// Incrementa views de um alerta
router.put('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE alerts SET views = views + 1 WHERE id = $1 RETURNING id, title, views',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alerta não encontrado' });
    }

    res.json({ success: true, views: result.rows[0].views });
  } catch (err) {
    console.error('❌ Erro ao incrementar views:', err.message);
    res.status(500).json({ error: 'Erro ao incrementar views' });
  }
});

module.exports = router;


