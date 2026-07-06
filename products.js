
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
// Lista todos os produtos
router.get('/', async (req, res) => {
  try {
    const { group, type, promo } = req.query;
    
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }

    if (promo === 'true') {
      sql += ' AND promo_active = TRUE AND promo_end_time > NOW()';
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    
    // Parse JSONB fields
    const parsed = result.rows.map(row => ({
      ...row,
      payment_links: typeof row.payment_links === 'string' ? JSON.parse(row.payment_links) : row.payment_links,
      access_links: typeof row.access_links === 'string' ? JSON.parse(row.access_links) : row.access_links,
      download_links: typeof row.download_links === 'string' ? JSON.parse(row.download_links) : row.download_links,
      edit_links: typeof row.edit_links === 'string' ? JSON.parse(row.edit_links) : row.edit_links,
      package_items: typeof row.package_items === 'string' ? JSON.parse(row.package_items) : row.package_items,
      promo_payment_links: typeof row.promo_payment_links === 'string' ? JSON.parse(row.promo_payment_links) : row.promo_payment_links,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    }));

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao listar produtos:', err.message);
    res.status(500).json({ error: 'Erro ao listar produtos' });
  }
});

// ==================== GET /:id ====================
// Busca um produto específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM products WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const row = result.rows[0];
    const parsed = {
      ...row,
      payment_links: typeof row.payment_links === 'string' ? JSON.parse(row.payment_links) : row.payment_links,
      access_links: typeof row.access_links === 'string' ? JSON.parse(row.access_links) : row.access_links,
      download_links: typeof row.download_links === 'string' ? JSON.parse(row.download_links) : row.download_links,
      edit_links: typeof row.edit_links === 'string' ? JSON.parse(row.edit_links) : row.edit_links,
      package_items: typeof row.package_items === 'string' ? JSON.parse(row.package_items) : row.package_items,
      promo_payment_links: typeof row.promo_payment_links === 'string' ? JSON.parse(row.promo_payment_links) : row.promo_payment_links,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    };

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao buscar produto:', err.message);
    res.status(500).json({ error: 'Erro ao buscar produto' });
  }
});

// ==================== POST / ====================
// Cria um novo produto
router.post('/', async (req, res) => {
  try {
    const productData = toSnake(req.body);
    
    if (!productData.name || !productData.id) {
      return res.status(400).json({ error: 'Nome e ID são obrigatórios' });
    }

    // Serializar JSONB fields
    const jsonbFields = ['payment_links', 'access_links', 'download_links', 'edit_links', 'package_items', 'promo_payment_links', 'countries', 'download_file'];
    jsonbFields.forEach(field => {
      if (productData[field] && typeof productData[field] === 'object') {
        productData[field] = JSON.stringify(productData[field]);
      }
    });

    const columns = Object.keys(productData);
    const values = Object.values(productData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO products (${columns.join(', ')}) 
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
      payment_links: typeof row.payment_links === 'string' ? JSON.parse(row.payment_links) : row.payment_links,
      access_links: typeof row.access_links === 'string' ? JSON.parse(row.access_links) : row.access_links,
      download_links: typeof row.download_links === 'string' ? JSON.parse(row.download_links) : row.download_links,
      edit_links: typeof row.edit_links === 'string' ? JSON.parse(row.edit_links) : row.edit_links,
      package_items: typeof row.package_items === 'string' ? JSON.parse(row.package_items) : row.package_items,
      promo_payment_links: typeof row.promo_payment_links === 'string' ? JSON.parse(row.promo_payment_links) : row.promo_payment_links,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    };

    res.status(201).json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao criar produto:', err.message);
    res.status(500).json({ error: 'Erro ao criar produto' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um produto
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productData = toSnake(req.body);
    
    const existingProduct = await query('SELECT id FROM products WHERE id = $1', [id]);

    if (existingProduct.rows.length === 0) {
      // Criar se não existe
      const columns = Object.keys(productData);
      const values = Object.values(productData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const jsonbFields = ['payment_links', 'access_links', 'download_links', 'edit_links', 'package_items', 'promo_payment_links', 'countries', 'download_file'];
      const processedData = { ...productData };
      jsonbFields.forEach(field => {
        if (processedData[field] && typeof processedData[field] === 'object') {
          processedData[field] = JSON.stringify(processedData[field]);
        }
      });

      const insertSql = `INSERT INTO products (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(processedData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    // Atualizar
    const columns = Object.keys(productData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    const jsonbFields = ['payment_links', 'access_links', 'download_links', 'edit_links', 'package_items', 'promo_payment_links', 'countries', 'download_file'];
    const processedData = { ...productData };
    jsonbFields.forEach(field => {
      if (processedData[field] && typeof processedData[field] === 'object') {
        processedData[field] = JSON.stringify(processedData[field]);
      }
    });

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => processedData[col]);
    values.push(id);

    const updateSql = `
      UPDATE products 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar produto:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar produto' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um produto
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM products WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    res.json({ 
      success: true, 
      message: `Produto "${result.rows[0].name}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar produto:', err.message);
    res.status(500).json({ error: 'Erro ao deletar produto' });
  }
});

// ==================== PUT /:id/increment-client ====================
// Incrementa o contador de clientes reais
router.put('/:id/increment-client', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE products 
       SET real_clients = real_clients + 1, updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, name, real_clients, clients`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    res.json({
      success: true,
      product: toCamel(result.rows[0]),
      message: 'Cliente incrementado com sucesso'
    });
  } catch (err) {
    console.error('❌ Erro ao incrementar cliente:', err.message);
    res.status(500).json({ error: 'Erro ao incrementar cliente' });
  }
});

module.exports = router;
