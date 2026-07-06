
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
// Busca estatísticas de exibição (display_stats)
router.get('/', async (req, res) => {
  try {
    // Buscar display_stats
    const statsResult = await query('SELECT * FROM display_stats ORDER BY id DESC LIMIT 1');
    
    let stats = {
      totalUsers: 127,
      totalCountries: 52,
      totalProducts: 200,
      totalReviews: 0
    };

    if (statsResult.rows.length > 0) {
      stats = toCamel(statsResult.rows[0]);
    }

    // Calcular estatísticas reais do banco
    const usersCount = await query('SELECT COUNT(*) as count FROM users WHERE account_deleted = FALSE');
    const productsCount = await query('SELECT COUNT(*) as count FROM products');
    const servicesCount = await query('SELECT COUNT(*) as count FROM services');
    const freeCount = await query('SELECT COUNT(*) as count FROM free_products');
    const reviewsCount = await query('SELECT COUNT(*) as count FROM reviews WHERE is_demo = FALSE');
    const countriesCount = await query('SELECT COUNT(DISTINCT country_name) as count FROM users WHERE account_deleted = FALSE AND country_name IS NOT NULL');
    const coursesCount = await query('SELECT COUNT(*) as count FROM courses WHERE status = $1', ['active']);
    const postsCount = await query('SELECT COUNT(*) as count FROM posts WHERE status = $1', ['active']);
    const purchasesCount = await query('SELECT COUNT(*) as count FROM purchases');
    const totalRevenue = await query('SELECT COALESCE(SUM(price), 0) as total FROM purchases');
    const todayPurchases = await query("SELECT COUNT(*) as count FROM purchases WHERE created_at >= CURRENT_DATE");
    const onlineUsers = await query("SELECT COUNT(*) as count FROM users WHERE updated_at >= NOW() - INTERVAL '15 minutes' AND account_deleted = FALSE");

    res.json({
      ...stats,
      realTimeStats: {
        totalUsers: parseInt(usersCount.rows[0].count),
        totalProducts: parseInt(productsCount.rows[0].count) + parseInt(servicesCount.rows[0].count) + parseInt(freeCount.rows[0].count),
        totalReviews: parseInt(reviewsCount.rows[0].count),
        totalCountries: parseInt(countriesCount.rows[0].count),
        activeCourses: parseInt(coursesCount.rows[0].count),
        activePosts: parseInt(postsCount.rows[0].count),
        totalPurchases: parseInt(purchasesCount.rows[0].count),
        totalRevenue: parseFloat(totalRevenue.rows[0].total),
        todayPurchases: parseInt(todayPurchases.rows[0].count),
        onlineUsers: parseInt(onlineUsers.rows[0].count)
      }
    });
  } catch (err) {
    console.error('❌ Erro ao buscar estatísticas:', err.message);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// ==================== PUT / ====================
// Atualiza as estatísticas de exibição
router.put('/', async (req, res) => {
  try {
    const { totalUsers, totalCountries, totalProducts, totalReviews } = req.body;
    
    const statsResult = await query('SELECT id FROM display_stats ORDER BY id DESC LIMIT 1');
    
    let result;
    if (statsResult.rows.length > 0) {
      // Atualizar registro existente
      result = await query(
        `UPDATE display_stats 
         SET total_users = $1, total_countries = $2, total_products = $3, total_reviews = $4, updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [totalUsers || 127, totalCountries || 52, totalProducts || 200, totalReviews || 0, statsResult.rows[0].id]
      );
    } else {
      // Inserir novo registro
      result = await query(
        `INSERT INTO display_stats (total_users, total_countries, total_products, total_reviews, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [totalUsers || 127, totalCountries || 52, totalProducts || 200, totalReviews || 0]
      );
    }

    res.json({ success: true, stats: toCamel(result.rows[0]) });
  } catch (err) {
    console.error('❌ Erro ao atualizar estatísticas:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar estatísticas' });
  }
});

// ==================== GET /system-config ====================
// Busca todas as configurações do sistema
router.get('/system-config', async (req, res) => {
  try {
    const result = await query('SELECT key, value FROM system_config ORDER BY key');
    
    // Converter para objeto
    const config = {};
    result.rows.forEach(row => {
      config[row.key] = row.value;
    });

    res.json(config);
  } catch (err) {
    console.error('❌ Erro ao buscar configurações:', err.message);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

module.exports = router;


