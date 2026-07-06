

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
// Lista todos os posts ativos (com comentários)
router.get('/', async (req, res) => {
  try {
    const { group, status, limit, offset } = req.query;
    
    let sql = 'SELECT * FROM posts WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    } else {
      sql += " AND status = 'active'";
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      params.push(parseInt(limit));
      sql += ` LIMIT $${params.length}`;
    }

    if (offset) {
      params.push(parseInt(offset));
      sql += ` OFFSET $${params.length}`;
    }

    const postsResult = await query(sql, params);
    
    // Buscar comentários e likes para cada post
    const posts = await Promise.all(postsResult.rows.map(async (post) => {
      const commentsResult = await query(
        'SELECT * FROM post_comments WHERE post_id = $1 ORDER BY created_at DESC',
        [post.id]
      );
      
      const likesResult = await query(
        'SELECT user_id FROM post_likes WHERE post_id = $1',
        [post.id]
      );

      return {
        ...post,
        comments: commentsResult.rows,
        likes: likesResult.rows.map(r => r.user_id),
        secondary_images: typeof post.secondary_images === 'string' ? JSON.parse(post.secondary_images) : post.secondary_images,
        countries: typeof post.countries === 'string' ? JSON.parse(post.countries) : post.countries,
      };
    }));

    res.json(toCamel(posts));
  } catch (err) {
    console.error('❌ Erro ao listar posts:', err.message);
    res.status(500).json({ error: 'Erro ao listar posts' });
  }
});

// ==================== GET /:id ====================
// Busca um post específico (com comentários e likes)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const postResult = await query('SELECT * FROM posts WHERE id = $1', [id]);

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    const post = postResult.rows[0];
    
    const commentsResult = await query(
      'SELECT * FROM post_comments WHERE post_id = $1 ORDER BY created_at DESC',
      [post.id]
    );
    
    const likesResult = await query(
      'SELECT user_id FROM post_likes WHERE post_id = $1',
      [post.id]
    );

    res.json(toCamel({
      ...post,
      comments: commentsResult.rows,
      likes: likesResult.rows.map(r => r.user_id),
      secondary_images: typeof post.secondary_images === 'string' ? JSON.parse(post.secondary_images) : post.secondary_images,
      countries: typeof post.countries === 'string' ? JSON.parse(post.countries) : post.countries,
    }));
  } catch (err) {
    console.error('❌ Erro ao buscar post:', err.message);
    res.status(500).json({ error: 'Erro ao buscar post' });
  }
});

// ==================== POST / ====================
// Cria um novo post
router.post('/', async (req, res) => {
  try {
    const postData = toSnake(req.body);
    
    if (!postData.title || !postData.content || !postData.id) {
      return res.status(400).json({ error: 'Título, conteúdo e ID são obrigatórios' });
    }

    // Serializar JSONB fields
    if (postData.secondary_images && typeof postData.secondary_images === 'object') {
      postData.secondary_images = JSON.stringify(postData.secondary_images);
    }
    if (postData.countries && typeof postData.countries === 'object') {
      postData.countries = JSON.stringify(postData.countries);
    }
    if (postData.likes && Array.isArray(postData.likes)) {
      delete postData.likes; // Likes são gerenciados separadamente
    }
    if (postData.comments && Array.isArray(postData.comments)) {
      delete postData.comments; // Comentários são gerenciados separadamente
    }

    const columns = Object.keys(postData);
    const values = Object.values(postData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `
      INSERT INTO posts (${columns.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${columns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        updated_at = NOW()
      RETURNING *
    `;

    const result = await query(sql, [...values, ...values]);
    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao criar post:', err.message);
    res.status(500).json({ error: 'Erro ao criar post' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um post
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const postData = toSnake(req.body);
    
    const existingPost = await query('SELECT id FROM posts WHERE id = $1', [id]);

    if (existingPost.rows.length === 0) {
      const columns = Object.keys(postData);
      const values = Object.values(postData);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      if (postData.secondary_images && typeof postData.secondary_images === 'object') {
        postData.secondary_images = JSON.stringify(postData.secondary_images);
      }
      if (postData.countries && typeof postData.countries === 'object') {
        postData.countries = JSON.stringify(postData.countries);
      }
      delete postData.likes;
      delete postData.comments;

      const insertSql = `INSERT INTO posts (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, Object.values(postData));
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    const columns = Object.keys(postData).filter(k => k !== 'id' && k !== 'likes' && k !== 'comments');
    
    if (columns.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }

    if (postData.secondary_images && typeof postData.secondary_images === 'object') {
      postData.secondary_images = JSON.stringify(postData.secondary_images);
    }
    if (postData.countries && typeof postData.countries === 'object') {
      postData.countries = JSON.stringify(postData.countries);
    }

    const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map(col => postData[col]);
    values.push(id);

    const updateSql = `
      UPDATE posts 
      SET ${setClauses.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
      RETURNING *
    `;

    const result = await query(updateSql, values);
    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao atualizar post:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar post' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um post (CASCADE deleta comentários e likes)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const postResult = await query('SELECT id, title FROM posts WHERE id = $1', [id]);
    
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    // Deletar interações
    await query('DELETE FROM post_interactions WHERE post_id = $1', [id]);
    
    // Deletar post (CASCADE deleta comentários e likes)
    await query('DELETE FROM posts WHERE id = $1', [id]);

    res.json({ 
      success: true, 
      message: `Post "${postResult.rows[0].title}" deletado com sucesso`,
      id: id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar post:', err.message);
    res.status(500).json({ error: 'Erro ao deletar post' });
  }
});

// ==================== POST /:id/comments ====================
// Adiciona um comentário a um post
router.post('/:id/comments', async (req, res) => {
  try {
    const { id: postId } = req.params;
    const commentData = toSnake(req.body);
    
    if (!commentData.text || !commentData.id) {
      return res.status(400).json({ error: 'Texto e ID do comentário são obrigatórios' });
    }

    // Verificar se o post existe
    const postExists = await query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (postExists.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    commentData.post_id = postId;

    const columns = Object.keys(commentData);
    const values = Object.values(commentData);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const sql = `INSERT INTO post_comments (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const result = await query(sql, values);

    res.status(201).json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao adicionar comentário:', err.message);
    res.status(500).json({ error: 'Erro ao adicionar comentário' });
  }
});

// ==================== DELETE /:postId/comments/:commentId ====================
// Deleta um comentário
router.delete('/:postId/comments/:commentId', async (req, res) => {
  try {
    const { postId, commentId } = req.params;

    const result = await query(
      'DELETE FROM post_comments WHERE id = $1 AND post_id = $2 RETURNING id',
      [commentId, postId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Comentário não encontrado' });
    }

    res.json({ success: true, message: 'Comentário deletado com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao deletar comentário:', err.message);
    res.status(500).json({ error: 'Erro ao deletar comentário' });
  }
});

// ==================== POST /:id/like ====================
// Adiciona/remove like de um post
router.post('/:id/like', async (req, res) => {
  try {
    const { id: postId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId é obrigatório' });
    }

    // Verificar se o post existe
    const postExists = await query('SELECT id FROM posts WHERE id = $1', [postId]);
    if (postExists.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    // Verificar se já deu like
    const existingLike = await query(
      'SELECT * FROM post_likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (existingLike.rows.length > 0) {
      // Remover like
      await query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
      return res.json({ liked: false, message: 'Like removido' });
    } else {
      // Adicionar like
      await query(
        'INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)',
        [postId, userId]
      );
      return res.json({ liked: true, message: 'Like adicionado' });
    }
  } catch (err) {
    console.error('❌ Erro ao processar like:', err.message);
    res.status(500).json({ error: 'Erro ao processar like' });
  }
});

// ==================== POST /:id/view ====================
// Incrementa views de um post
router.post('/:id/view', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      'UPDATE posts SET views = views + 1 WHERE id = $1 RETURNING id, title, views',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado' });
    }

    res.json({ success: true, views: result.rows[0].views });
  } catch (err) {
    console.error('❌ Erro ao incrementar views:', err.message);
    res.status(500).json({ error: 'Erro ao incrementar views' });
  }
});

// ==================== GET /:postId/interactions/:userId ====================
// Busca interações de um usuário em um post
router.get('/:postId/interactions/:userId', async (req, res) => {
  try {
    const { postId, userId } = req.params;

    const result = await query(
      'SELECT * FROM post_interactions WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    if (result.rows.length === 0) {
      return res.json({ liked: false, viewed: false, commented: false });
    }

    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao buscar interações:', err.message);
    res.status(500).json({ error: 'Erro ao buscar interações' });
  }
});

// ==================== PUT /:postId/interactions/:userId ====================
// Salva interações de um usuário em um post
router.put('/:postId/interactions/:userId', async (req, res) => {
  try {
    const { postId, userId } = req.params;
    const interactionData = toSnake(req.body);
    
    const interactionId = `inter_${userId}_${postId}`;
    
    const existing = await query(
      'SELECT id FROM post_interactions WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    );

    let result;
    if (existing.rows.length > 0) {
      const columns = Object.keys(interactionData).filter(k => k !== 'id' && k !== 'post_id' && k !== 'user_id');
      const setClauses = columns.map((col, i) => `${col} = $${i + 1}`);
      const values = columns.map(col => interactionData[col]);
      values.push(postId, userId);

      const sql = `
        UPDATE post_interactions 
        SET ${setClauses.join(', ')}, updated_at = NOW()
        WHERE post_id = $${values.length - 1} AND user_id = $${values.length}
        RETURNING *
      `;
      result = await query(sql, values);
    } else {
      result = await query(
        `INSERT INTO post_interactions (id, post_id, user_id, liked, viewed, commented, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [
          interactionId,
          postId,
          userId,
          interactionData.liked || false,
          interactionData.viewed || false,
          interactionData.commented || false
        ]
      );
    }

    res.json({ success: true, interaction: toCamel(result.rows[0]) });
  } catch (err) {
    console.error('❌ Erro ao salvar interações:', err.message);
    res.status(500).json({ error: 'Erro ao salvar interações' });
  }
});

module.exports = router;


