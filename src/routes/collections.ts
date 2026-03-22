import { Hono } from 'hono';

interface Env {
  DB: D1Database;
}

export const collections = new Hono<{ Bindings: Env }>();

// List user's collections
collections.get('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  const type = c.req.query('type'); // poem, ci, prose, or all
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '20');
  const offset = (page - 1) * pageSize;

  // For demo, use a fixed user id
  // In production, extract from JWT token
  const userId = 'demo-user';

  let whereClause = 'WHERE user_id = ?';
  const params: (string | number)[] = [userId];

  if (type && type !== 'all') {
    whereClause += ' AND content_type = ?';
    params.push(type);
  }

  // Get total count
  const countResult = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM collections ${whereClause}`)
    .bind(...params)
    .first();
  const total = countResult?.total || 0;

  // Get collections with content details
  const collectionsQuery = await c.env.DB
    .prepare(`
      SELECT c.*, p.title, p.author_name, p.dynasty, p.content, p.poem_type
      FROM collections c
      LEFT JOIN poems p ON c.content_type = 'poem' AND c.content_id = p.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset);

  const items = await collectionsQuery.all();

  return c.json({
    success: true,
    data: {
      items: items.results.map((item: Record<string, unknown>) => ({
        ...item,
        content: item.content ? JSON.parse(item.content as string) : null,
      })),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    },
  });
});

// Add to collection
collections.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  const { content_type, content_id, notes } = await c.req.json();

  if (!content_type || !content_id) {
    return c.json({ success: false, error: 'content_type and content_id required' }, 400);
  }

  // For demo, use a fixed user id
  const userId = 'demo-user';

  const id = crypto.randomUUID();

  try {
    await c.env.DB
      .prepare(`
        INSERT INTO collections (id, user_id, content_type, content_id, notes)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(id, userId, content_type, content_id, notes || null)
      .run();

    return c.json({
      success: true,
      data: { id, user_id: userId, content_type, content_id, notes },
    }, 201);
  } catch (err) {
    return c.json({ success: false, error: 'Already in collection' }, 409);
  }
});

// Remove from collection
collections.delete('/:id', async (c) => {
  const id = c.req.param('id');

  await c.env.DB
    .prepare('DELETE FROM collections WHERE id = ?')
    .bind(id)
    .run();

  return c.json({ success: true, message: 'Removed from collection' });
});
