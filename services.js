
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
// Lista todos os serviços
router.get('/', async (req, res) => {
  try {
    const { group, category } = req.query;
    
    let sql = 'SELECT * FROM services WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, params);
    
    // Parse JSONB fields
    const parsed = result.rows.map(row => ({
      ...row,
      payment_links: typeof row.payment_links === 'string' ? JSON.parse(row.payment_links) : row.payment_links,
      promo_payment_links: typeof row.promo_payment_links === 'string' ? JSON.parse(row.promo_payment_links) : row.promo_payment_links,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    }));

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao listar serviços:', err.message);
    res.status(500).json({ error: 'Erro ao listar serviços' });
  }
});

// ==================== GET /:id ====================
// Busca um serviço específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM services WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Serviço não encontrado' });
    }

    const row = result.rows[0];
    const parsed = {
      ...row,
      payment_links: typeof row.payment_links === 'string' ? JSON.parse(row.payment_links) : row.payment_links,
      promo_payment_links: typeof row.promo_payment_links === 'string' ? JSON.parse(row.promo_payment_links) : row.promo_payment_links,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    };

    res.json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao buscar serviço:', err.message);
    res.status(500).json({ error: 'Erro ao buscar serviço' });
  }
});

// ==================== POST / ====================
// Cria um novo serviço
router.post('/', async (req, res) => {
  try {
    const serviceData = toSnake(req.body);
    
    if (!serviceData.name || !serviceData.id) {
      return res.status(400).json({ error: 'Nome e ID são obrigatórios' });
    }

    const jsonbFields = ['payment_links', 'promo_payment_links', 'countries'];
    jsonbFields.forEach(field => {
      if (serviceData[field] && typeof serviceData[field] === 'object') {
        serviceData[field] = JSON.stringify(serviceData[field]);
      }
    });

    const columns = Object.keys(serviceData);
    const values = Object.values(serviceData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO services (${columns.join(', ')}) 
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
      promo_payment_links: typeof row.promo_payment_links === 'string' ? JSON.parse(row.promo_payment_links) : row.promo_payment_links,
      countries: typeof row.countries === 'string' ? JSON.parse(row.countries) : row.countries,
    };

    res.status(201).json(toCamel(parsed));
  } catch (err) {
    console.error('❌ Erro ao criar serviço:', err.message);
    res.status(500).json({ error: 'Erro ao criar serviço' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um serviço
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const serviceData = toSnake(req.body);
    
    const existingService = await query('SELECT id FROM services WHERE id = $1', [id]);

    if (existingService.rows.length === 0) {
      const columns = Object.keys(serviceData);
      const values = Object.values(serviceData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const jsonbFields = ['payment_links', 'promo_payment_links', 'countries'];
      const processedData = { ...serviceData };
      jsonbFields.forEach(field => {
        if (processedData[field] && typeof processedData[field] === 'object') {
          processedData[field] = JSON.stringify(processedData[field]);
        }
      });

      const insertSql = `INSERT INTO services (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(processedData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(serviceData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    const jsonbFields = ['payment_links', 'promo_payment_links', 'countries'];
    const processedData = { ...serviceData };
    jsonbFields.forEach(field => {
      if (processedData[field] && typeof processedData[field] === 'object') {
        processedData[field] = JSON.stringify(processedData[field]);
      }
    });

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => processedData[col]);
    values.push(id);

    const updateSql = `
      UPDATE services 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar serviço:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar serviço' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um serviço
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM services WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Serviço não encontrado' });
    }

    res.json({ 
      success: true, 
      message: `Serviço "${result.rows[0].name}" deletado com sucesso`,
      id: result.rows[0].id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar serviço:', err.message);
    res.status(500).json({ error: 'Erro ao deletar serviço' });
  }
});

// ==================== PUT /:id/increment-client ====================
// Incrementa o contador de clientes reais
router.put('/:id/increment-client', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE services 
       SET real_clients = real_clients + 1, updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, name, real_clients, clients`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Serviço não encontrado' });
    }

    res.json({
      success: true,
      service: toCamel(result.rows[0]),
      message: 'Cliente incrementado com sucesso'
    });
  } catch (err) {
    console.error('❌ Erro ao incrementar cliente:', err.message);
    res.status(500).json({ error: 'Erro ao incrementar cliente' });
  }
});

module.exports = router;
