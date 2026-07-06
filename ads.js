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
// Lista todos os anúncios
router.get('/', async (req, res) => {
  try {
    const { group, active } = req.query;
    
    let sql = 'SELECT * FROM ads WHERE 1=1';
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
      main_image_btn: typeof row.main_image_btn === 'string' ? JSON.parse(row.main_image_btn) : row.main_image_btn,
      sec1_image_btn: typeof row.sec1_image_btn === 'string' ? JSON.parse(row.sec1_image_btn) : row.sec1_image_btn,
      sec2_image_btn: typeof row.sec2_image_btn === 'string' ? JSON.parse(row.sec2_image_btn) : row.sec2_image_btn,
    }));

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao listar anúncios:', err.message);
    res.status(500).json({ error: 'Erro ao listar anúncios' });
  }
});

// ==================== POST / ====================
// Cria um novo anúncio
router.post('/', async (req, res) => {
  try {
    const adData = toSnake(req.body);
    
    if (!adData.title || !adData.id) {
      return res.status(400).json({ error: 'Título e ID são obrigatórios' });
    }

    // Serializar JSONB fields
    const jsonbFields = ['pages', 'main_image_btn', 'sec1_image_btn', 'sec2_image_btn'];
    jsonbFields.forEach(field => {
      if (adData[field] && typeof adData[field] === 'object') {
        adData[field] = JSON.stringify(adData[field]);
      }
    });

    const columns = Object.keys(adData);
    const values = Object.values(adData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO ads (${columns.join(', ')}) 
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
      main_image_btn: typeof row.main_image_btn === 'string' ? JSON.parse(row.main_image_btn) : row.main_image_btn,
      sec1_image_btn: typeof row.sec1_image_btn === 'string' ? JSON.parse(row.sec1_image_btn) : row.sec1_image_btn,
      sec2_image_btn: typeof row.sec2_image_btn === 'string' ? JSON.parse(row.sec2_image_btn) : row.sec2_image_btn,
    };

    res.status(201).json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao criar anúncio:', err.message);
    res.status(500).json({ error: 'Erro ao criar anúncio' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um anúncio
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const adData = toSnake(req.body);
    
    const existingAd = await query('SELECT id FROM ads WHERE id = $1', [id]);

    if (existingAd.rows.length === 0) {
      const columns = Object.keys(adData);
      const values = Object.values(adData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const jsonbFields = ['pages', 'main_image_btn', 'sec1_image_btn', 'sec2_image_btn'];
      jsonbFields.forEach(field => {
        if (adData[field] && typeof adData[field] === 'object') {
          adData[field] = JSON.stringify(adData[field]);
        }
      });

      const insertSql = `INSERT INTO ads (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(adData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(adData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    const jsonbFields = ['pages', 'main_image_btn', 'sec1_image_btn', 'sec2_image_btn'];
    jsonbFields.forEach(field => {
      if (adData[field] && typeof adData[field] === 'object') {
        adData[field] = JSON.stringify(adData[field]);
      }
    });

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => adData[col]);
    values.push(id);

    const updateSql = `
      UPDATE ads 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar anúncio:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar anúncio' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um anúncio
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM ads WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Anúncio não encontrado' });
    }

    // Limpar dismissed_ads
    await query('DELETE FROM dismissed_ads WHERE ad_id = $1', [id]);

    res.json({ 
      success: true, 
      message: `Anúncio "${result.rows[0].title}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar anúncio:', err.message);
    res.status(500).json({ error: 'Erro ao deletar anúncio' });
  }
});

// ==================== POST /:id/dismiss ====================
// Marca um anúncio como dispensado por um usuário
router.post('/:id/dismiss', async (req, res) => {
  try {
    const { id: adId } = req.params;
    const { userId, dismissUntil } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    // Calcular quando o anúncio pode reaparecer
    const adResult = await query('SELECT reappear_hours FROM ads WHERE id = $1', [adId]);
    const reappearHours = adResult.rows.length > 0 ? (adResult.rows[0].reappear_hours || 1) : 1;
    const dismissTime = dismissUntil || new Date(Date.now() + reappearHours * 3600 * 1000).toISOString();

    await query(
      `INSERT INTO dismissed_ads (user_id, ad_id, dismiss_until) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, ad_id) 
       DO UPDATE SET dismiss_until = $3`,
      [userId, adId, dismissTime]
    );

    res.json({ success: true, message: 'Anúncio dispensado com sucesso', dismissUntil: dismissTime });
  } catch (err) {
    console.error('❌ Erro ao dispensar anúncio:', err.message);
    res.status(500).json({ error: 'Erro ao dispensar anúncio' });
  }
});

module.exports = router;

