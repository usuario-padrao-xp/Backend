
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
// Lista todas as reviews (não demo)
router.get('/', async (req, res) => {
  try {
    const { userId, productId } = req.query;
    
    let sql = 'SELECT * FROM reviews WHERE 1=1';
    const params = [];

    if (userId) {
      params.push(userId);
      sql += ` AND user_id = $${params.length}`;
    }

    if (productId) {
      params.push(productId);
      sql += ` AND product_id = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    res.json(toCamel(result.rows));
  } catch (err) {
    console.error('❌ Erro ao listar reviews:', err.message);
    res.status(500).json({ error: 'Erro ao listar reviews' });
  }
});

// ==================== POST / ====================
// Cria uma nova review
router.post('/', async (req, res) => {
  try {
    const reviewData = toSnake(req.body);
    
    if (!reviewData.text || !reviewData.id) {
      return res.status(400).json({ error: 'Texto e ID são obrigatórios' });
    }

    if (reviewData.stars && (reviewData.stars < 1 || reviewData.stars > 5)) {
      return res.status(400).json({ error: 'Estrelas devem ser entre 1 e 5' });
    }

    const columns = Object.keys(reviewData);
    const values = Object.values(reviewData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO reviews (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        created_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao criar review:', err.message);
    res.status(500).json({ error: 'Erro ao criar review' });
  }
});

// ==================== DELETE /:id ====================
// Deleta uma review
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM reviews WHERE id = $1 RETURNING id, name, text',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review não encontrada' });
    }

    res.json({ 
      success: true, 
      message: 'Review deletada com sucesso',
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar review:', err.message);
    res.status(500).json({ error: 'Erro ao deletar review' });
  }
});

module.exports = router;



