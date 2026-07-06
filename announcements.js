
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
// Lista todos os comunicados/anúncios
router.get('/', async (req, res) => {
  try {
    const { group, active } = req.query;
    
    // Buscar da tabela alerts que também serve como announcements
    let sql = "SELECT * FROM alerts WHERE position = 'modal' OR position = 'center'";
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
    
    const parsed = result.rows.map(row => ({
      ...row,
      pages: typeof row.pages === 'string' ? JSON.parse(row.pages) : row.pages,
      buttons: typeof row.buttons === 'string' ? JSON.parse(row.buttons) : row.buttons,
    }));

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao listar comunicados:', err.message);
    res.status(500).json({ error: 'Erro ao listar comunicados' });
  }
});

// ==================== POST / ====================
// Cria um novo comunicado
router.post('/', async (req, res) => {
  try {
    const announcementData = toSnake(req.body);
    
    if (!announcementData.content || !announcementData.id) {
      return res.status(400).json({ error: 'Conteúdo e ID são obrigatórios' });
    }

    // Forçar position como modal/center para comunicados
    if (!announcementData.position) {
      announcementData.position = 'center';
    }

    if (announcementData.pages && typeof announcementData.pages === 'object') {
      announcementData.pages = JSON.stringify(announcementData.pages);
    }
    if (announcementData.buttons && typeof announcementData.buttons === 'object') {
      announcementData.buttons = JSON.stringify(announcementData.buttons);
    }

    const columns = Object.keys(announcementData);
    const values = Object.values(announcementData);
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
    console.error('❌ Erro ao criar comunicado:', err.message);
    res.status(500).json({ error: 'Erro ao criar comunicado' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um comunicado
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const announcementData = toSnake(req.body);
    
    const existing = await query('SELECT id FROM alerts WHERE id = $1', [id]);

    if (existing.rows.length === 0) {
      const columns = Object.keys(announcementData);
      const values = Object.values(announcementData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      if (announcementData.pages && typeof announcementData.pages === 'object') {
        announcementData.pages = JSON.stringify(announcementData.pages);
      }
      if (announcementData.buttons && typeof announcementData.buttons === 'object') {
        announcementData.buttons = JSON.stringify(announcementData.buttons);
      }

      const insertSql = `INSERT INTO alerts (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(announcementData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(announcementData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    if (announcementData.pages && typeof announcementData.pages === 'object') {
      announcementData.pages = JSON.stringify(announcementData.pages);
    }
    if (announcementData.buttons && typeof announcementData.buttons === 'object') {
      announcementData.buttons = JSON.stringify(announcementData.buttons);
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => announcementData[col]);
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
    console.error('❌ Erro ao atualizar comunicado:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar comunicado' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um comunicado
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM alerts WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Comunicado não encontrado' });
    }

    await query('DELETE FROM dismissed_alerts WHERE alert_id = $1', [id]);

    res.json({ 
      success: true, 
      message: `Comunicado "${result.rows[0].title || 'sem título'}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar comunicado:', err.message);
    res.status(500).json({ error: 'Erro ao deletar comunicado' });
  }
});

// ==================== PUT /:id/view ====================
// Incrementa views de um comunicado
router.put('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE alerts SET views = views + 1 WHERE id = $1 RETURNING id, title, views',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Comunicado não encontrado' });
    }

    res.json({ success: true, views: result.rows[0].views });
  } catch (err) {
    console.error('❌ Erro ao incrementar views:', err.message);
    res.status(500).json({ error: 'Erro ao incrementar views' });
  }
});

module.exports = router;
