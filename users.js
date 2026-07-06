
const express = require('express');
const router = express.Router();
const { query } = require('./database');

// Helpers
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
// Lista todos os usuários (não deletados)
router.get('/', async (req, res) => {
  try {
    const { group } = req.query;
    
    let sql = 'SELECT * FROM users WHERE account_deleted = FALSE';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    sql += ' ORDER BY registered_at DESC';

    const result = await query(sql, params);
    res.json(toCamel(result.rows));
  } catch (err) {
    console.error('❌ Erro ao listar usuários:', err.message);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// ==================== GET /:id ====================
// Busca um usuário específico
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT * FROM users WHERE id = $1 AND account_deleted = FALSE',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao buscar usuário:', err.message);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// ==================== GET /check-username/:username ====================
// Verifica se um username já existe
router.get('/check-username/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    const result = await query(
      'SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) AND account_deleted = FALSE',
      [username]
    );

    res.json({ 
      exists: result.rows.length > 0,
      username: username
    });
  } catch (err) {
    console.error('❌ Erro ao verificar username:', err.message);
    res.status(500).json({ error: 'Erro ao verificar username' });
  }
});

// ==================== POST / ====================
// Cria um novo usuário
router.post('/', async (req, res) => {
  try {
    const userData = toSnake(req.body);
    
    // Verificar campos obrigatórios
    if (!userData.username || !userData.id) {
      return res.status(400).json({ error: 'Username e ID são obrigatórios' });
    }

    // Verificar se username já existe
    const existingUser = await query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND account_deleted = FALSE',
      [userData.username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username já está em uso' });
    }

    // Construir query dinâmica
    const columns = Object.keys(userData);
    const values = Object.values(userData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO users (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        updated_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao criar usuário:', err.message);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um usuário
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userData = toSnake(req.body);
    
    // Verificar se usuário existe
    const existingUser = await query(
      'SELECT id FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      // Se não existe, criar
      const columns = Object.keys(userData);
      const values = Object.values(userData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const insertSql = `
        INSERT INTO users (${columns.join(', ')}) 
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `;

      const insertResult = await query(insertSql, values);
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    // Atualizar
    const columns = Object.keys(userData).filter(k => k !== 'id');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => userData[col]);
    values.push(id);

    const updateSql = `
      UPDATE users 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar usuário:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// ==================== PUT /:id/saved-links ====================
// Atualiza os links salvos de um usuário
router.put('/:id/saved-links', async (req, res) => {
  try {
    const { id } = req.params;
    const { savedLinks } = req.body;

    if (!savedLinks) {
      return res.status(400).json({ error: 'savedLinks é obrigatório' });
    }

    const result = await query(
      'UPDATE users SET saved_links = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [JSON.stringify(savedLinks), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar saved links:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar saved links' });
  }
});

// ==================== PUT /:id/messages ====================
// Atualiza as mensagens de um usuário
router.put('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { messages, unreadMessages } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (messages !== undefined) {
      updates.push(`messages = $${paramCount}`);
      values.push(JSON.stringify(messages));
      paramCount++;
    }

    if (unreadMessages !== undefined) {
      updates.push(`unread_messages = $${paramCount}`);
      values.push(unreadMessages);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    updates.push('updated_at = NOW()');
    values.push(id);

    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`;
    const result = await query(sql, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar mensagens:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar mensagens' });
  }
});

// ==================== DELETE /:id ====================
// Soft delete de um usuário
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE users 
       SET account_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND account_deleted = FALSE 
       RETURNING id, username, account_deleted, deleted_at`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado ou já deletado' });
    }

    res.json({ 
      success: true, 
      message: 'Usuário deletado com sucesso (soft delete)',
      user: toCamel(result.rows[0])
    });
  } catch (err) {
    console.error('❌ Erro ao deletar usuário:', err.message);
    res.status(500).json({ error: 'Erro ao deletar usuário' });
  }
});

// ==================== DELETE /:id/permanent ====================
// Hard delete de um usuário
router.delete('/:id/permanent', async (req, res) => {
  try {
    const { id } = req.params;

    // Primeiro, buscar o usuário
    const userResult = await query('SELECT id, username FROM users WHERE id = $1', [id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const username = userResult.rows[0].username;

    // Deletar dados relacionados
    await query('DELETE FROM course_progress WHERE user_id = $1', [id]);
    await query('DELETE FROM post_likes WHERE user_id = $1', [id]);
    await query('DELETE FROM post_comments WHERE user_id = $1', [id]);
    await query('DELETE FROM post_interactions WHERE user_id = $1', [id]);
    await query('DELETE FROM reviews WHERE user_id = $1', [id]);
    await query('DELETE FROM purchases WHERE user_id = $1', [id]);
    await query('DELETE FROM transactions WHERE user_id = $1', [id]);
    await query('DELETE FROM sent_messages WHERE recipient_id = $1', [id]);
    await query('DELETE FROM dismissed_alerts WHERE user_id = $1', [id]);
    await query('DELETE FROM dismissed_ads WHERE user_id = $1', [id]);
    await query('DELETE FROM notifications WHERE target_user_id = $1', [id]);
    await query('DELETE FROM intruders_log WHERE user_id = $1', [id]);
    
    // Deletar o usuário
    await query('DELETE FROM users WHERE id = $1', [id]);

    res.json({ 
      success: true, 
      message: `Usuário ${username} deletado permanentemente`,
      userId: id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar usuário permanentemente:', err.message);
    res.status(500).json({ error: 'Erro ao deletar usuário permanentemente' });
  }
});

module.exports = router;
