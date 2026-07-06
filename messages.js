
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
// Lista todas as mensagens enviadas
router.get('/', async (req, res) => {
  try {
    const { recipientId, type, group, limit } = req.query;
    
    let sql = 'SELECT * FROM sent_messages WHERE 1=1';
    const params = [];

    if (recipientId) {
      params.push(recipientId);
      sql += ` AND recipient_id = $${params.length}`;
    }

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      params.push(parseInt(limit));
      sql += ` LIMIT $${params.length}`;
    }

    const result = await query(sql, params);
    res.json(toCamel(result.rows));
  } catch (err) {
    console.error('❌ Erro ao listar mensagens:', err.message);
    res.status(500).json({ error: 'Erro ao listar mensagens' });
  }
});

// ==================== POST / ====================
// Cria e envia uma nova mensagem
router.post('/', async (req, res) => {
  try {
    const messageData = toSnake(req.body);
    
    if (!messageData.text || !messageData.id) {
      return res.status(400).json({ error: 'Texto e ID são obrigatórios' });
    }

    const columns = Object.keys(messageData);
    const values = Object.values(messageData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO sent_messages (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        created_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    const savedMessage = result.rows[0];

    // Se for mensagem individual, adicionar à caixa de mensagens do destinatário
    if (savedMessage.type === 'individual' && savedMessage.recipient_id) {
      const userResult = await query(
        'SELECT id, messages, unread_messages FROM users WHERE id = $1 AND account_deleted = FALSE',
        [savedMessage.recipient_id]
      );

      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        let messages = typeof user.messages === 'string' ? JSON.parse(user.messages) : (user.messages || []);
        
        messages.push({
          id: savedMessage.id,
          title: savedMessage.title || 'Nova mensagem',
          text: savedMessage.text,
          date: savedMessage.created_at || new Date().toISOString(),
          isRead: false,
          image: null
        });

        await query(
          'UPDATE users SET messages = $1, unread_messages = unread_messages + 1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(messages), savedMessage.recipient_id]
        );
      }
    }

    // Se for mensagem em grupo, adicionar para todos do grupo
    if (savedMessage.type === 'group' && savedMessage.group) {
      const groupUsers = await query(
        'SELECT id, messages, unread_messages FROM users WHERE "group" = $1 AND account_deleted = FALSE',
        [savedMessage.group]
      );

      for (const user of groupUsers.rows) {
        let messages = typeof user.messages === 'string' ? JSON.parse(user.messages) : (user.messages || []);
        
        messages.push({
          id: savedMessage.id + '_' + user.id,
          title: savedMessage.title || 'Nova mensagem',
          text: savedMessage.text,
          date: savedMessage.created_at || new Date().toISOString(),
          isRead: false,
          image: null
        });

        await query(
          'UPDATE users SET messages = $1, unread_messages = unread_messages + 1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(messages), user.id]
        );
      }

      // Atualizar recipient_count
      await query(
        'UPDATE sent_messages SET recipient_count = $1 WHERE id = $2',
        [groupUsers.rows.length, savedMessage.id]
      );
    }

    res.status(201).json(toCamel(savedMessage));
  } catch (err) {
    console.error('❌ Erro ao criar mensagem:', err.message);
    res.status(500).json({ error: 'Erro ao criar mensagem' });
  }
});

// ==================== DELETE /:id ====================
// Deleta uma mensagem enviada
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar mensagem antes de deletar
    const msgResult = await query('SELECT * FROM sent_messages WHERE id = $1', [id]);
    
    if (msgResult.rows.length === 0) {
      return res.status(404).json({ error: 'Mensagem não encontrada' });
    }

    const msg = msgResult.rows[0];

    // Remover mensagem das caixas de entrada dos usuários
    if (msg.type === 'individual' && msg.recipient_id) {
      const userResult = await query(
        'SELECT id, messages FROM users WHERE id = $1',
        [msg.recipient_id]
      );

      if (userResult.rows.length > 0) {
        let messages = typeof userResult.rows[0].messages === 'string' 
          ? JSON.parse(userResult.rows[0].messages) 
          : (userResult.rows[0].messages || []);
        
        messages = messages.filter(m => m.id !== msg.id);
        
        await query(
          'UPDATE users SET messages = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(messages), msg.recipient_id]
        );
      }
    }

    // Deletar mensagem
    await query('DELETE FROM sent_messages WHERE id = $1', [id]);

    res.json({ success: true, message: 'Mensagem deletada com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao deletar mensagem:', err.message);
    res.status(500).json({ error: 'Erro ao deletar mensagem' });
  }
});

module.exports = router;

