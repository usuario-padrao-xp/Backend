
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

// ==================== GET / ====================
// Busca todas as configurações do sistema
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT key, value, updated_at FROM system_config ORDER BY key');
    
    // Converter para objeto
    const config = {};
    result.rows.forEach(row => {
      config[row.key] = row.value;
    });

    res.json({
      config,
      raw: toCamel(result.rows)
    });
  } catch (err) {
    console.error('❌ Erro ao buscar configurações:', err.message);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

// ==================== GET /:key ====================
// Busca uma configuração específica
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    const result = await query(
      'SELECT key, value, updated_at FROM system_config WHERE key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    res.json(toCamel(result.rows[0]));
  } catch (err) {
    console.error('❌ Erro ao buscar configuração:', err.message);
    res.status(500).json({ error: 'Erro ao buscar configuração' });
  }
});

// ==================== PUT /:key ====================
// Atualiza ou cria uma configuração
router.put('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Valor é obrigatório' });
    }

    const result = await query(
      `INSERT INTO system_config (key, value, updated_at) 
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [key, String(value)]
    );

    res.json({ success: true, config: toCamel(result.rows[0]) });
  } catch (err) {
    console.error('❌ Erro ao atualizar configuração:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar configuração' });
  }
});

// ==================== POST /batch ====================
// Atualiza múltiplas configurações de uma vez
router.post('/batch', async (req, res) => {
  try {
    const configs = req.body;
    
    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ error: 'Objeto de configurações é obrigatório' });
    }

    const results = [];
    for (const [key, value] of Object.entries(configs)) {
      const result = await query(
        `INSERT INTO system_config (key, value, updated_at) 
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
         RETURNING key, value`,
        [key, String(value)]
      );
      results.push(result.rows[0]);
    }

    res.json({ 
      success: true, 
      message: `${results.length} configurações atualizadas`,
      configs: results
    });
  } catch (err) {
    console.error('❌ Erro ao atualizar configurações em lote:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar configurações em lote' });
  }
});

// ==================== DELETE /:key ====================
// Deleta uma configuração
router.delete('/:key', async (req, res) => {
  try {
    const { key } = req.params;

    // Não permitir deletar configurações críticas
    const criticalKeys = ['admin_password', 'login_password', 'security_password', 'platform_name'];
    if (criticalKeys.includes(key)) {
      return res.status(403).json({ error: 'Não é permitido deletar configurações críticas' });
    }

    const result = await query(
      'DELETE FROM system_config WHERE key = $1 RETURNING key',
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Configuração não encontrada' });
    }

    res.json({ success: true, message: `Configuração "${key}" deletada com sucesso` });
  } catch (err) {
    console.error('❌ Erro ao deletar configuração:', err.message);
    res.status(500).json({ error: 'Erro ao deletar configuração' });
  }
});

module.exports = router;
