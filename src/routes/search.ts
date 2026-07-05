import { Hono } from 'hono';
import { pageParams, paginated } from './helpers';

interface Env {
  DB: D1Database;
}

export const search = new Hono<{ Bindings: Env }>();

search.get('/', async (c) => {
  const q = (c.req.query('q') || c.req.query('query') || '').trim();
  const type = c.req.query('type');
  const genre = c.req.query('genre');
  const dynasty = c.req.query('dynasty');
  const { page, pageSize, offset } = pageParams((name) => c.req.query(name));

  if (!q) {
    return c.json({ success: false, error: 'Search query required' }, 400);
  }

  const like = `%${q}%`;
  let where = `
    WHERE (content_search.title LIKE ? OR content_search.author LIKE ? OR content_search.body LIKE ?)
  `;
  const params: (string | number)[] = [like, like, like];

  if (type) {
    where += ' AND content_search.entity_type = ?';
    params.push(type);
  }
  if (genre) {
    where += ' AND content_search.genre = ?';
    params.push(genre);
  }
  if (dynasty) {
    where += ' AND content_search.dynasty = ?';
    params.push(dynasty);
  }

  const count = await c.env.DB
    .prepare(`SELECT COUNT(*) AS total FROM content_search ${where}`)
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB
    .prepare(`
      SELECT content_search.entity_type, content_search.entity_id, content_search.title,
        content_search.author, content_search.dynasty, content_search.genre,
        content_search.collection,
        collections.slug AS collection_slug,
        substr(content_search.body, 1, 120) AS snippet
      FROM content_search
      LEFT JOIN works ON content_search.entity_type = 'work' AND works.id = content_search.entity_id
      LEFT JOIN book_nodes ON content_search.entity_type = 'node' AND book_nodes.id = content_search.entity_id
      LEFT JOIN content_collections collections ON collections.id = COALESCE(works.collection_id, book_nodes.collection_id)
      ${where}
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset)
    .all();

  return c.json({
    success: true,
    data: paginated(rows.results, count?.total || 0, page, pageSize),
  });
});

search.get('/suggest', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) {
    return c.json({ success: true, data: [] });
  }

  const like = `%${q}%`;
  const rows = await c.env.DB
    .prepare(`
      SELECT content_search.entity_type, content_search.entity_id, content_search.title,
        content_search.author, content_search.dynasty, content_search.genre,
        content_search.collection,
        collections.slug AS collection_slug
      FROM content_search
      LEFT JOIN works ON content_search.entity_type = 'work' AND works.id = content_search.entity_id
      LEFT JOIN book_nodes ON content_search.entity_type = 'node' AND book_nodes.id = content_search.entity_id
      LEFT JOIN content_collections collections ON collections.id = COALESCE(works.collection_id, book_nodes.collection_id)
      WHERE content_search.title LIKE ? OR content_search.author LIKE ?
      LIMIT 10
    `)
    .bind(like, like)
    .all();

  return c.json({ success: true, data: rows.results });
});
