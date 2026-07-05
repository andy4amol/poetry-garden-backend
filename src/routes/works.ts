import { Hono } from 'hono';
import { pageParams, paginated, serializeParagraph, serializeWork } from './helpers';

interface Env {
  DB: D1Database;
}

export const works = new Hono<{ Bindings: Env }>();

works.get('/', async (c) => {
  const { page, pageSize, offset } = pageParams((name) => c.req.query(name));
  const genre = c.req.query('genre') || c.req.query('type');
  const dynasty = c.req.query('dynasty');
  const authorId = c.req.query('author_id');
  const collectionId = c.req.query('collection_id');
  const rhythmic = c.req.query('rhythmic');
  const q = c.req.query('q') || c.req.query('search');

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (genre) {
    where += ' AND w.genre = ?';
    params.push(genre);
  }
  if (dynasty) {
    where += ' AND w.dynasty = ?';
    params.push(dynasty);
  }
  if (authorId) {
    where += ' AND w.author_id = ?';
    params.push(authorId);
  }
  if (collectionId) {
    where += ' AND w.collection_id = ?';
    params.push(collectionId);
  }
  if (rhythmic) {
    where += ' AND w.rhythmic = ?';
    params.push(rhythmic);
  }
  if (q) {
    where += ` AND (
      w.title_traditional LIKE ? OR w.title_simplified LIKE ? OR
      w.author_name_traditional LIKE ? OR w.author_name_simplified LIKE ? OR
      w.plain_text_traditional LIKE ? OR w.plain_text_simplified LIKE ?
    )`;
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const count = await c.env.DB
    .prepare(`SELECT COUNT(*) AS total FROM works w ${where}`)
    .bind(...params)
    .first<{ total: number }>();

  const result = await c.env.DB
    .prepare(`
      SELECT w.id, w.title_traditional, w.title_simplified, w.author_id,
        w.author_name_traditional, w.author_name_simplified, w.dynasty,
        w.genre, w.form_type, w.rhythmic, w.collection_id,
        c.title_simplified AS collection_title_simplified,
        c.title_traditional AS collection_title_traditional,
        w.content_traditional, w.content_simplified, w.tags,
        w.popularity_score, w.word_count, w.line_count
      FROM works w
      LEFT JOIN content_collections c ON c.id = w.collection_id
      ${where}
      ORDER BY w.popularity_score DESC, w.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset)
    .all();

  return c.json({
    success: true,
    data: paginated(result.results.map((row) => serializeWork(row as Record<string, unknown>)), count?.total || 0, page, pageSize),
  });
});

works.get('/random', async (c) => {
  const genre = c.req.query('genre');
  const dynasty = c.req.query('dynasty');
  let where = 'WHERE 1=1';
  const params: string[] = [];
  if (genre) {
    where += ' AND genre = ?';
    params.push(genre);
  }
  if (dynasty) {
    where += ' AND dynasty = ?';
    params.push(dynasty);
  }

  const row = await c.env.DB
    .prepare(`SELECT * FROM works ${where} ORDER BY RANDOM() LIMIT 1`)
    .bind(...params)
    .first();

  if (!row) {
    return c.json({ success: false, error: 'Work not found' }, 404);
  }

  return c.json({ success: true, data: serializeWork(row as Record<string, unknown>) });
});

works.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB
    .prepare(`
      SELECT w.*, c.slug AS collection_slug,
        c.title_simplified AS collection_title_simplified,
        c.title_traditional AS collection_title_traditional,
        a.description_simplified AS author_description_simplified,
        a.description_traditional AS author_description_traditional
      FROM works w
      LEFT JOIN content_collections c ON c.id = w.collection_id
      LEFT JOIN content_authors a ON a.id = w.author_id
      WHERE w.id = ?
    `)
    .bind(id)
    .first();

  if (!row) {
    return c.json({ success: false, error: 'Work not found' }, 404);
  }

  const paragraphRows = await c.env.DB
    .prepare('SELECT * FROM paragraphs WHERE work_id = ? ORDER BY order_index')
    .bind(id)
    .all();

  const strainRows = await c.env.DB
    .prepare('SELECT line_index, pattern FROM work_strains WHERE work_id = ? ORDER BY line_index')
    .bind(id)
    .all();

  return c.json({
    success: true,
    data: {
      ...serializeWork(row as Record<string, unknown>),
      paragraphs: paragraphRows.results.map((item) => serializeParagraph(item as Record<string, unknown>)),
      strains: strainRows.results,
    },
  });
});
