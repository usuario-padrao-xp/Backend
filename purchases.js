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
// Lista todas as compras
router.get('/', async (req, res) => {
  try {
    const { userId, productId, status, group, country, limit, offset, startDate, endDate } = req.query;
    
    let sql = 'SELECT * FROM purchases WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (userId) {
      paramCount++;
      params.push(userId);
      sql += ` AND user_id = $${paramCount}`;
    }

    if (productId) {
      paramCount++;
      params.push(productId);
      sql += ` AND product_id = $${paramCount}`;
    }

    if (status) {
      paramCount++;
      params.push(status);
      sql += ` AND status = $${paramCount}`;
    }

    if (group) {
      paramCount++;
      params.push(group);
      sql += ` AND user_group = $${paramCount}`;
    }

    if (country) {
      paramCount++;
      params.push(country);
      sql += ` AND user_country = $${paramCount}`;
    }

    if (startDate) {
      paramCount++;
      params.push(startDate);
      sql += ` AND created_at >= $${paramCount}`;
    }

    if (endDate) {
      paramCount++;
      params.push(endDate);
      sql += ` AND created_at <= $${paramCount}`;
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      paramCount++;
      params.push(parseInt(limit));
      sql += ` LIMIT $${paramCount}`;
    }

    if (offset) {
      paramCount++;
      params.push(parseInt(offset));
      sql += ` OFFSET $${paramCount}`;
    }

    const result = await query(sql, params);

    // Calcular totais para estatísticas
    let statsSql = 'SELECT COUNT(*) as total_count, COALESCE(SUM(price), 0) as total_revenue, COUNT(DISTINCT user_id) as unique_buyers, COUNT(DISTINCT user_country) as unique_countries FROM purchases WHERE 1=1';
    const statsParams = [];
    let statsParamCount = 0;

    if (userId) { statsParamCount++; statsParams.push(userId); statsSql += ` AND user_id = $${statsParamCount}`; }
    if (productId) { statsParamCount++; statsParams.push(productId); statsSql += ` AND product_id = $${statsParamCount}`; }
    if (status) { statsParamCount++; statsParams.push(status); statsSql += ` AND status = $${statsParamCount}`; }
    if (group) { statsParamCount++; statsParams.push(group); statsSql += ` AND user_group = $${statsParamCount}`; }
    if (country) { statsParamCount++; statsParams.push(country); statsSql += ` AND user_country = $${statsParamCount}`; }
    if (startDate) { statsParamCount++; statsParams.push(startDate); statsSql += ` AND created_at >= $${statsParamCount}`; }
    if (endDate) { statsParamCount++; statsParams.push(endDate); statsSql += ` AND created_at <= $${statsParamCount}`; }

    const statsResult = await query(statsSql, statsParams);

    res.json({
      purchases: toCamel(result.rows),
      stats: toCamel(statsResult.rows[0])
    });
  } catch (err) {
    console.error('❌ Erro ao listar compras:', err.message);
    res.status(500).json({ error: 'Erro ao listar compras' });
  }
});

// ==================== POST / ====================
// Cria uma nova compra
router.post('/', async (req, res) => {
  try {
    const purchaseData = toSnake(req.body);
    
    if (!purchaseData.id) {
      purchaseData.id = 'PUR-' + Date.now().toString(36).toUpperCase() + '_' + Math.random().toString(36).substr(2, 6);
    }

    if (!purchaseData.product_id && !purchaseData.product_name) {
      return res.status(400).json({ error: 'ID ou nome do produto é obrigatório' });
    }

    const columns = Object.keys(purchaseData);
    const values = Object.values(purchaseData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO purchases (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        created_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    
    // Incrementar real_clients no produto correspondente
    if (purchaseData.product_id) {
      try {
        await query(
          'UPDATE products SET real_clients = real_clients + 1 WHERE id = $1',
          [purchaseData.product_id]
        );
      } catch (e) {
        // Silencioso - pode ser serviço ou produto grátis
      }
      try {
        await query(
          'UPDATE services SET real_clients = real_clients + 1 WHERE id = $1',
          [purchaseData.product_id]
        );
      } catch (e) {}
      try {
        await query(
          'UPDATE free_products SET real_clients = real_clients + 1 WHERE id = $1',
          [purchaseData.product_id]
        );
      } catch (e) {}
    }

    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao criar compra:', err.message);
    res.status(500).json({ error: 'Erro ao criar compra' });
  }
});

// ==================== DELETE /:id ====================
// Deleta uma compra
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM purchases WHERE id = $1 RETURNING id, product_name, user_name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Compra não encontrada' });
    }

    res.json({ 
      success: true, 
      message: `Compra "${result.rows[0].product_name}" deletada com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar compra:', err.message);
    res.status(500).json({ error: 'Erro ao deletar compra' });
  }
});

// ==================== DELETE /clear-all ====================
// Limpa todo o histórico de compras (uso administrativo)
router.delete('/clear-all', async (req, res) => {
  try {
    const countResult = await query('SELECT COUNT(*) as count FROM purchases');
    const count = parseInt(countResult.rows[0].count);

    await query('DELETE FROM purchases');

    res.json({ 
      success: true, 
      message: `${count} compras foram deletadas permanentemente`,
      deletedCount: count
    });
  } catch (err) {
    console.error('❌ Erro ao limpar compras:', err.message);
    res.status(500).json({ error: 'Erro ao limpar compras' });
  }
});

module.exports = router;