
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
// Lista todos os produtos gratuitos
router.get('/', async (req, res) => {
  try {
    const { group, type } = req.query;
    
    let sql = 'SELECT * FROM free_products WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
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
    console.error('❌ Erro ao listar produtos gratuitos:', err.message);
    res.status(500).json({ error: 'Erro ao listar produtos gratuitos' });
  }
});

// ==================== GET /:id ====================
// Busca um produto gratuito específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM free_products WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto gratuito não encontrado' });
    }

    const row = result.rows[0];
    const parsed = {
      ...row,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    };

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao buscar produto gratuito:', err.message);
    res.status(500).json({ error: 'Erro ao buscar produto gratuito' });
  }
});

// ==================== POST / ====================
// Cria um novo produto gratuito
router.post('/', async (req, res) => {
  try {
    const productData = toSnake(req.body);
    
    if (!productData.name || !productData.id) {
      return res.status(400).json({ error: 'Nome e ID são obrigatórios' });
    }

    // Serializar JSONB fields
    if (productData.countries && typeof productData.countries === 'object') {
      productData.countries = JSON.stringify(productData.countries);
    }

    const columns = Object.keys(productData);
    const values = Object.values(productData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO free_products (${columns.join(', ')}) 
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
    console.error('❌ Erro ao criar produto gratuito:', err.message);
    res.status(500).json({ error: 'Erro ao criar produto gratuito' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um produto gratuito
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productData = toSnake(req.body);
    
    const existingProduct = await query('SELECT id FROM free_products WHERE id = $1', [id]);

    if (existingProduct.rows.length === 0) {
      const columns = Object.keys(productData);
      const values = Object.values(productData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      if (productData.countries && typeof productData.countries === 'object') {
        productData.countries = JSON.stringify(productData.countries);
      }

      const insertSql = `INSERT INTO free_products (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(productData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(productData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    if (productData.countries && typeof productData.countries === 'object') {
      productData.countries = JSON.stringify(productData.countries);
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => productData[col]);
    values.push(id);

    const updateSql = `
      UPDATE free_products 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar produto gratuito:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar produto gratuito' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um produto gratuito
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM free_products WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto gratuito não encontrado' });
    }

    res.json({ 
      success: true, 
      message: `Produto gratuito "${result.rows[0].name}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar produto gratuito:', err.message);
    res.status(500).json({ error: 'Erro ao deletar produto gratuito' });
  }
});

// ==================== PUT /:id/increment-client ====================
// Incrementa o contador de acessos
router.put('/:id/increment-client', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE free_products 
       SET real_clients = real_clients + 1, updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, name, real_clients, clients`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto gratuito não encontrado' });
    }

    res.json({
      success: true,
      product: toCamel(result.rows[0]),
      message: 'Acesso incrementado com sucesso'
    });
  } catch (err) {
    console.error('❌ Erro ao incrementar acesso:', err.message);
    res.status(500).json({ error: 'Erro ao incrementar acesso' });
  }
});

module.exports = router;
