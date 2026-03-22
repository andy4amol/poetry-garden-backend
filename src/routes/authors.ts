import { Hono } from 'hono';

interface Env {
  DB: D1Database;
}

export const authors = new Hono<{ Bindings: Env }>();

// List all authors
authors.get('/', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '20');
  const dynasty = c.req.query('dynasty');
  const search = c.req.query('search');

  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (dynasty) {
    whereClause += ' AND dynasty = ?';
    params.push(dynasty);
  }
  if (search) {
    whereClause += ' AND (name LIKE ? OR name_traditional LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Get total count
  const countResult = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM authors ${whereClause}`)
    .bind(...params)
    .first();
  const total = countResult?.total || 0;

  // Get authors with work count
  const authorsQuery = await c.env.DB
    .prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM poems WHERE author_id = a.id) as work_count
      FROM authors a
      ${whereClause}
      ORDER BY a.name ASC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset);

  const items = await authorsQuery.all();

  return c.json({
    success: true,
    data: {
      items: items.results,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    },
  });
});

// Get single author with their poems
authors.get('/:id', async (c) => {
  const id = c.req.param('id');

  // Get author
  const author = await c.env.DB
    .prepare('SELECT * FROM authors WHERE id = ?')
    .bind(id)
    .first();

  if (!author) {
    return c.json({ success: false, error: 'Author not found' }, 404);
  }

  // Get author's poems
  const poems = await c.env.DB
    .prepare(`
      SELECT * FROM poems WHERE author_id = ?
      ORDER BY poem_type, title
      LIMIT 50
    `)
    .bind(id)
    .all();

  // Get author's ci poems
  const ciPoems = await c.env.DB
    .prepare(`
      SELECT * FROM poems WHERE author_id = ? AND poem_type = 'ci'
      ORDER BY rhythmic, title
      LIMIT 50
    `)
    .bind(id)
    .all();

  // Get author's other works (classical, etc)
  const otherWorks = await c.env.DB
    .prepare(`
      SELECT * FROM poems WHERE author_id = ? AND poem_type NOT IN ('shi', 'ci')
      ORDER BY poem_type, title
      LIMIT 50
    `)
    .bind(id)
    .all();

  return c.json({
    success: true,
    data: {
      ...author,
      poems: poems.results.map((p: Record<string, unknown>) => ({
        ...p,
        content: JSON.parse(p.content as string),
      })),
      ci_poems: ciPoems.results.map((p: Record<string, unknown>) => ({
        ...p,
        content: JSON.parse(p.content as string),
      })),
      other_works: otherWorks.results.map((p: Record<string, unknown>) => ({
        ...p,
        content: JSON.parse(p.content as string),
      })),
    },
  });
});
