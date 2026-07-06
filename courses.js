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
// Lista todos os cursos (com aulas)
router.get('/', async (req, res) => {
  try {
    const { group, status } = req.query;
    
    let sql = 'SELECT * FROM courses WHERE 1=1';
    const params = [];

    if (group) {
      params.push(group);
      sql += ` AND "group" = $${params.length}`;
    }

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const coursesResult = await query(sql, params);
    
    // Buscar aulas para cada curso
    const courses = await Promise.all(coursesResult.rows.map(async (course) => {
      const lessonsResult = await query(
        'SELECT * FROM course_lessons WHERE course_id = $1 ORDER BY sort_order ASC',
        [course.id]
      );
      return {
        ...course,
        lessons: lessonsResult.rows
      };
    }));

    res.json(toCamel(courses));
  } catch (err) {
    console.error('❌ Erro ao listar cursos:', err.message);
    res.status(500).json({ error: 'Erro ao listar cursos' });
  }
});

// ==================== GET /access/:code ====================
// Busca um curso pelo código de acesso (com aulas)
router.get('/access/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    const courseResult = await query(
      'SELECT * FROM courses WHERE access_code = $1 AND status = $2',
      [code, 'active']
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Curso não encontrado ou inativo' });
    }

    const course = courseResult.rows[0];
    
    // Buscar aulas
    const lessonsResult = await query(
      'SELECT * FROM course_lessons WHERE course_id = $1 ORDER BY sort_order ASC',
      [course.id]
    );

    const fullCourse = {
      ...course,
      lessons: lessonsResult.rows
    };

    // Incrementar views do curso
    await query(
      'UPDATE courses SET updated_at = NOW() WHERE id = $1',
      [course.id]
    );

    res.json(toCamel(fullCourse));
  } catch (err) {
    console.error('❌ Erro ao acessar curso:', err.message);
    res.status(500).json({ error: 'Erro ao acessar curso' });
  }
});

// ==================== GET /:id ====================
// Busca um curso específico (com aulas)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const courseResult = await query('SELECT * FROM courses WHERE id = $1', [id]);

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Curso não encontrado' });
    }

    const course = courseResult.rows[0];
    
    const lessonsResult = await query(
      'SELECT * FROM course_lessons WHERE course_id = $1 ORDER BY sort_order ASC',
      [course.id]
    );

    res.json(toCamel({
      ...course,
      lessons: lessonsResult.rows
    }));
  } catch (err) {
    console.error('❌ Erro ao buscar curso:', err.message);
    res.status(500).json({ error: 'Erro ao buscar curso' });
  }
});

// ==================== POST / ====================
// Cria um novo curso com aulas
router.post('/', async (req, res) => {
  const client = await query('BEGIN');
  try {
    const courseData = toSnake(req.body);
    const { lessons, ...courseFields } = courseData;
    
    if (!courseFields.name || !courseFields.id) {
      await query('ROLLBACK');
      return res.status(400).json({ error: 'Nome e ID são obrigatórios' });
    }

    // Gerar código de acesso se não fornecido
    if (!courseFields.access_code) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let code = 'Aulas.html_';
      for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
      courseFields.access_code = code;
    }

    // Verificar se código de acesso já existe
    const existingCode = await query(
      'SELECT id FROM courses WHERE access_code = $1',
      [courseFields.access_code]
    );

    if (existingCode.rows.length > 0) {
      await query('ROLLBACK');
      return res.status(409).json({ error: 'Código de acesso já está em uso' });
    }

    // Inserir curso
    const courseColumns = Object.keys(courseFields);
    const courseValues = Object.values(courseFields);
    const coursePlaceholders = courseValues.map((_, i) => `$${i + 1}`);

    const courseSql = `
      INSERT INTO courses (${courseColumns.join(', ')}) 
      VALUES (${coursePlaceholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${courseColumns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
        updated_at = NOW()
      RETURNING *
    `;

    const courseResult = await query(courseSql, [...courseValues, ...courseValues]);
    const savedCourse = courseResult.rows[0];

    // Inserir aulas
    let savedLessons = [];
    if (lessons && Array.isArray(lessons) && lessons.length > 0) {
      // Deletar aulas existentes
      await query('DELETE FROM course_lessons WHERE course_id = $1', [savedCourse.id]);

      for (const lesson of lessons) {
        const lessonSnake = toSnake(lesson);
        lessonSnake.course_id = savedCourse.id;
        
        if (!lessonSnake.id) {
          lessonSnake.id = 'lesson_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }

        const lessonColumns = Object.keys(lessonSnake);
        const lessonValues = Object.values(lessonSnake);
        const lessonPlaceholders = lessonValues.map((_, i) => `$${i + 1}`);

        const lessonSql = `
          INSERT INTO course_lessons (${lessonColumns.join(', ')}) 
          VALUES (${lessonPlaceholders.join(', ')})
          ON CONFLICT (id) DO UPDATE SET
            ${lessonColumns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
            created_at = NOW()
          RETURNING *
        `;

        const lessonResult = await query(lessonSql, [...lessonValues, ...lessonValues]);
        savedLessons.push(lessonResult.rows[0]);
      }
    }

    await query('COMMIT');

    res.status(201).json(toCamel({
      ...savedCourse,
      lessons: savedLessons
    }));
  } catch (err) {
    await query('ROLLBACK');
    console.error('❌ Erro ao criar curso:', err.message);
    res.status(500).json({ error: 'Erro ao criar curso' });
  }
});

// ==================== PUT /:id ====================
// Atualiza um curso e suas aulas
router.put('/:id', async (req, res) => {
  const client = await query('BEGIN');
  try {
    const { id } = req.params;
    const courseData = toSnake(req.body);
    const { lessons, ...courseFields } = courseData;
    
    const existingCourse = await query('SELECT id FROM courses WHERE id = $1', [id]);

    if (existingCourse.rows.length === 0) {
      await query('ROLLBACK');
      
      // Criar novo curso se não existe
      if (!courseFields.access_code) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let code = 'Aulas.html_';
        for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        courseFields.access_code = code;
      }

      const columns = Object.keys(courseFields);
      const values = Object.values(courseFields);
      const placeholders = values.map((_, i) => `$${i + 1}`);

      const insertSql = `INSERT INTO courses (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
      const insertResult = await query(insertSql, values);
      
      await query('COMMIT');
      return res.status(201).json(toCamel(insertResult.rows[0]));
    }

    // Atualizar curso
    const courseColumns = Object.keys(courseFields).filter(k => k !== 'id');
    
    if (courseColumns.length > 0) {
      const setClauses = courseColumns.map((col, i) => `${col} = $${i + 1}`);
      const courseValues = courseColumns.map(col => courseFields[col]);
      courseValues.push(id);

      const updateSql = `
        UPDATE courses 
        SET ${setClauses.join(', ')}, updated_at = NOW()
        WHERE id = $${courseValues.length}
        RETURNING *
      `;

      await query(updateSql, courseValues);
    }

    // Atualizar aulas
    if (lessons && Array.isArray(lessons)) {
      // Deletar aulas existentes
      await query('DELETE FROM course_lessons WHERE course_id = $1', [id]);

      // Inserir novas aulas
      for (const lesson of lessons) {
        const lessonSnake = toSnake(lesson);
        lessonSnake.course_id = id;
        
        if (!lessonSnake.id) {
          lessonSnake.id = 'lesson_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }

        const lessonColumns = Object.keys(lessonSnake);
        const lessonValues = Object.values(lessonSnake);
        const lessonPlaceholders = lessonValues.map((_, i) => `$${i + 1}`);

        const lessonSql = `
          INSERT INTO course_lessons (${lessonColumns.join(', ')}) 
          VALUES (${lessonPlaceholders.join(', ')})
          ON CONFLICT (id) DO UPDATE SET
            ${lessonColumns.map((col, i) => `${col} = $${i + 1}`).join(', ')},
            created_at = NOW()
        `;

        await query(lessonSql, [...lessonValues, ...lessonValues]);
      }
    }

    // Buscar curso atualizado com aulas
    const updatedCourse = await query('SELECT * FROM courses WHERE id = $1', [id]);
    const updatedLessons = await query(
      'SELECT * FROM course_lessons WHERE course_id = $1 ORDER BY sort_order ASC',
      [id]
    );

    await query('COMMIT');

    res.json(toCamel({
      ...updatedCourse.rows[0],
      lessons: updatedLessons.rows
    }));
  } catch (err) {
    await query('ROLLBACK');
    console.error('❌ Erro ao atualizar curso:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar curso' });
  }
});

// ==================== DELETE /:id ====================
// Deleta um curso e suas aulas (CASCADE)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar curso antes de deletar
    const courseResult = await query('SELECT id, name FROM courses WHERE id = $1', [id]);
    
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Curso não encontrado' });
    }

    const courseName = courseResult.rows[0].name;

    // Deletar progresso dos alunos
    await query('DELETE FROM course_progress WHERE course_id = $1', [id]);
    
    // Deletar aulas (CASCADE deve fazer isso automaticamente)
    await query('DELETE FROM course_lessons WHERE course_id = $1', [id]);
    
    // Deletar curso
    await query('DELETE FROM courses WHERE id = $1', [id]);

    res.json({ 
      success: true, 
      message: `Curso "${courseName}" e todas as suas aulas foram deletados`,
      id: id
    });
  } catch (err) {
    console.error('❌ Erro ao deletar curso:', err.message);
    res.status(500).json({ error: 'Erro ao deletar curso' });
  }
});

// ==================== GET /:courseId/progress/:userId ====================
// Busca o progresso de um usuário em um curso
router.get('/:courseId/progress/:userId', async (req, res) => {
  try {
    const { courseId, userId } = req.params;
    
    const result = await query(
      'SELECT * FROM course_progress WHERE course_id = $1 AND user_id = $2',
      [courseId, userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        completedLessons: [],
        totalSecondsWatched: 0,
        milestonesShown: {}
      });
    }

    const row = result.rows[0];
    res.json({
      completedLessons: typeof row.completed_lessons === 'string' ? JSON.parse(row.completed_lessons) : row.completed_lessons,
      totalSecondsWatched: row.total_seconds_watched || 0,
      milestonesShown: typeof row.milestones_shown === 'string' ? JSON.parse(row.milestones_shown) : row.milestones_shown
    });
  } catch (err) {
    console.error('❌ Erro ao buscar progresso:', err.message);
    res.status(500).json({ error: 'Erro ao buscar progresso' });
  }
});

// ==================== PUT /:courseId/progress/:userId ====================
// Salva o progresso de um usuário em um curso
router.put('/:courseId/progress/:userId', async (req, res) => {
  try {
    const { courseId, userId } = req.params;
    const { completedLessons, totalSecondsWatched, milestonesShown, lastLessonIndex } = req.body;
    
    const progressId = `prog_${userId}_${courseId}`;
    
    const existing = await query(
      'SELECT id FROM course_progress WHERE course_id = $1 AND user_id = $2',
      [courseId, userId]
    );

    let result;
    if (existing.rows.length > 0) {
      // Atualizar
      result = await query(
        `UPDATE course_progress 
         SET completed_lessons = $1, total_seconds_watched = $2, milestones_shown = $3, updated_at = NOW()
         WHERE course_id = $4 AND user_id = $5
         RETURNING *`,
        [
          JSON.stringify(completedLessons || []),
          totalSecondsWatched || 0,
          JSON.stringify(milestonesShown || {}),
          courseId,
          userId
        ]
      );
    } else {
      // Inserir
      result = await query(
        `INSERT INTO course_progress (id, course_id, user_id, completed_lessons, total_seconds_watched, milestones_shown, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [
          progressId,
          courseId,
          userId,
          JSON.stringify(completedLessons || []),
          totalSecondsWatched || 0,
          JSON.stringify(milestonesShown || {})
        ]
      );
    }

    res.json({
      success: true,
      progress: toCamel(result.rows[0]),
      message: 'Progresso salvo com sucesso'
    });
  } catch (err) {
    console.error('❌ Erro ao salvar progresso:', err.message);
    res.status(500).json({ error: 'Erro ao salvar progresso' });
  }
});

module.exports = router;











