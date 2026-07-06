const express = require('express');
const router = express.Router();
const { query } = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'aegisworks_super_secret_key_2024';

// ==================== HELPERS ====================
function toSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

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

// ==================== POST /login ====================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username e password são obrigatórios' });
    }

    const result = await query(
      'SELECT * FROM users WHERE username = $1 AND account_deleted = FALSE',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    
    // Verificar password (plain text comparison - o frontend envia senha em texto)
    // Em produção, usar bcrypt.compare()
    const validPassword = password === user.password || 
                          password === user.secondary_password;

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Gerar token JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, group: user.group },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: toCamel(user)
    });
  } catch (err) {
    console.error('❌ Erro no login:', err.message);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// ==================== POST /verify ====================
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token é obrigatório' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await query(
      'SELECT id, username, full_name, email, "group", language, country_name, avatar FROM users WHERE id = $1 AND account_deleted = FALSE',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Token inválido ou conta excluída' });
    }

    res.json({ valid: true, user: toCamel(result.rows[0]) });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token inválido ou expirado' });
    }
    console.error('❌ Erro na verificação:', err.message);
    res.status(500).json({ error: 'Erro ao verificar token' });
  }
});

// ==================== PUT /change-password ====================
router.put('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Password atual e nova são obrigatórias' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Nova password deve ter pelo menos 4 caracteres' });
    }

    // Buscar password atual do admin
    const configResult = await query(
      "SELECT value FROM system_config WHERE key = 'admin_password'"
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    const storedPassword = configResult.rows[0].value;

    if (currentPassword !== storedPassword) {
      return res.status(401).json({ error: 'Password atual incorreta' });
    }

    // Atualizar password
    await query(
      "UPDATE system_config SET value = $1, updated_at = NOW() WHERE key = 'admin_password'",
      [newPassword]
    );

    res.json({ success: true, message: 'Password alterada com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao alterar password:', err.message);
    res.status(500).json({ error: 'Erro ao alterar password' });
  }
});

// ==================== PUT /change-security-password ====================
router.put('/change-security-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Password atual e nova são obrigatórias' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Nova password deve ter pelo menos 4 caracteres' });
    }

    const configResult = await query(
      "SELECT value FROM system_config WHERE key = 'security_password'"
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    const storedPassword = configResult.rows[0].value;

    if (currentPassword !== storedPassword) {
      return res.status(401).json({ error: 'Password atual incorreta' });
    }

    await query(
      "UPDATE system_config SET value = $1, updated_at = NOW() WHERE key = 'security_password'",
      [newPassword]
    );

    res.json({ success: true, message: 'Password de segurança alterada com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao alterar password de segurança:', err.message);
    res.status(500).json({ error: 'Erro ao alterar password de segurança' });
  }
});

// ==================== PUT /change-login-password ====================
router.put('/change-login-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Password atual e nova são obrigatórias' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Nova password deve ter pelo menos 4 caracteres' });
    }

    const configResult = await query(
      "SELECT value FROM system_config WHERE key = 'login_password'"
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    const storedPassword = configResult.rows[0].value;

    if (currentPassword !== storedPassword) {
      return res.status(401).json({ error: 'Password atual incorreta' });
    }

    await query(
      "UPDATE system_config SET value = $1, updated_at = NOW() WHERE key = 'login_password'",
      [newPassword]
    );

    res.json({ success: true, message: 'Password de login alterada com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao alterar password de login:', err.message);
    res.status(500).json({ error: 'Erro ao alterar password de login' });
  }
});

// ==================== GET /check-password/:type ====================
router.get('/check-password/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const validTypes = ['admin', 'security', 'login'];
    
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Tipo inválido. Use: admin, security ou login' });
    }

    const key = type === 'admin' ? 'admin_password' : 
               type === 'security' ? 'security_password' : 'login_password';

    const result = await query(
      'SELECT key, value FROM system_config WHERE key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false, value: null });
    }

    res.json({ exists: true, value: result.rows[0].value, key: result.rows[0].key });
  } catch (err) {
    console.error('❌ Erro ao verificar password:', err.message);
    res.status(500).json({ error: 'Erro ao verificar password' });
  }
});

module.exports = router;
