
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
// Lista todos os banners
router.get('/', async (req, res) => {
  try {
    const { group, category, active } = req.query;
    
    let sql = 'SELECT * FROM banners WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
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
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    }));

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao listar banners:', err.message);
    res.status(500).json({ error: 'Erro ao listar banners' });
  }
});

// ==================== POST / ====================
// Cria um novo banner
router.post('/', async (req, res) => {
  try {
    const bannerData = toSnake(req.body);
    
    if (!bannerData.title || !bannerData.id) {
      return res.status(400).json({ error: 'Título e ID são obrigatórios' });
    }

    // Serializar JSONB fields
    if (bannerData.countries && typeof bannerData.countries === 'object') {
      bannerData.countries = JSON.stringify(bannerData.countries);
    }

    const columns = Object.keys(bannerData);
    const values = Object.values(bannerData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO banners (${columns.join(', ')}) 
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
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    };

    res.status(201).json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao criar banner:', err.message);
    res.status(500).json({ error: 'Erro ao criar banner' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um banner
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const bannerData = toSnake(req.body);
    
    const existingBanner = await query('SELECT id FROM banners WHERE id = $1', [id]);

    if (existingBanner.rows.length === 0) {
      const columns = Object.keys(bannerData);
      const values = Object.values(bannerData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      if (bannerData.countries && typeof bannerData.countries === 'object') {
        bannerData.countries = JSON.stringify(bannerData.countries);
      }

      const insertSql = `INSERT INTO banners (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(bannerData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(bannerData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    if (bannerData.countries && typeof bannerData.countries === 'object') {
      bannerData.countries = JSON.stringify(bannerData.countries);
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => bannerData[col]);
    values.push(id);

    const updateSql = `
      UPDATE banners 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar banner:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar banner' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um banner
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM banners WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Banner não encontrado' });
    }

    res.json({ 
      success: true, 
      message: `Banner "${result.rows[0].title}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar banner:', err.message);
    res.status(500).json({ error: 'Erro ao deletar banner' });
  }
});

module.exports = router;
