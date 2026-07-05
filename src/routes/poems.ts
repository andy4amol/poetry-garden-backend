import { Hono } from 'hono';
import { z } from 'zod';

interface Env {
  DB: D1Database;
}

export const poems = new Hono<{ Bindings: Env }>();

const DYNASTY_ALIASES: Record<string, string> = {
  tang: '唐',
  song: '宋',
  yuan: '元',
  ming: '明',
  qing: '清',
  '1': '唐',
  '2': '宋',
  '3': '元',
  '4': '明',
  '5': '清',
};

function normalizeDynasty(dynasty?: string) {
  if (!dynasty) return undefined;
  return DYNASTY_ALIASES[dynasty.toLowerCase()] || dynasty;
}

function parseJsonList(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  try {
    return JSON.parse(value);
  } catch {
    return value.split(/\\+n|\r?\n/).filter(Boolean);
  }
}

function serializePoem(p: Record<string, unknown>) {
  return {
    ...p,
    author: p.author_name || p.author || '',
    content: parseJsonList(p.content),
    content_simplified: p.content_simplified ? parseJsonList(p.content_simplified) : undefined,
    tags: parseJsonList(p.tags),
  };
}

// Validation schemas
const poemSchema = z.object({
  title: z.string(),
  dynasty: z.string(),
  content: z.array(z.string()),
  author_id: z.string().optional(),
  form_type: z.string().optional(),
  poem_type: z.string().optional(),
});

// List poems with pagination and filters
poems.get('/', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '20');
  const dynasty = normalizeDynasty(c.req.query('dynasty'));
  const poemType = c.req.query('poem_type');
  const authorId = c.req.query('author_id');
  const search = c.req.query('search') || c.req.query('q');

  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (dynasty) {
    whereClause += ' AND p.dynasty = ?';
    params.push(dynasty);
  }
  if (poemType) {
    whereClause += ' AND p.poem_type = ?';
    params.push(poemType);
  }
  if (authorId) {
    whereClause += ' AND p.author_id = ?';
    params.push(authorId);
  }
  if (search) {
    whereClause += ' AND (p.title LIKE ? OR p.search_content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Get total count
  const countResult = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM poems p ${whereClause}`)
    .bind(...params)
    .first();
  const total = countResult?.total || 0;

  // Get poems
  const poemsQuery = await c.env.DB
    .prepare(`
      SELECT p.*, a.name as author_name
      FROM poems p
      LEFT JOIN authors a ON p.author_id = a.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset);

  const items = await poemsQuery.all();

  return c.json({
    success: true,
    data: {
      items: items.results.map((p: Record<string, unknown>) => serializePoem(p)),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    },
  });
});

// Get random poem
poems.get('/random', async (c) => {
  const result = await c.env.DB
    .prepare(`
      SELECT p.*, a.name as author_name
      FROM poems p
      LEFT JOIN authors a ON p.author_id = a.id
      ORDER BY RANDOM()
      LIMIT 1
    `)
    .all();

  const firstResult = result.results?.[0];

  if (!firstResult) {
    return c.json({ success: false, error: 'No poems found' }, 404);
  }

  return c.json({
    success: true,
    data: serializePoem(firstResult as Record<string, unknown>),
  });
});

// Search poems
poems.get('/search', async (c) => {
  const q = c.req.query('q') || c.req.query('search');
  const page = parseInt(c.req.query('page') || '1');
  const pageSize = parseInt(c.req.query('page_size') || '20');

  if (!q) {
    return c.json({ success: false, error: 'Search query required' }, 400);
  }

  const offset = (page - 1) * pageSize;

  const searchPattern = `%${q}%`;

  const countResult = await c.env.DB
    .prepare(`
      SELECT COUNT(*) as total FROM poems
      WHERE title LIKE ? OR search_content LIKE ?
    `)
    .bind(searchPattern, searchPattern)
    .first();

  const total = countResult?.total || 0;

  const results = await c.env.DB
    .prepare(`
      SELECT p.*, a.name as author_name
      FROM poems p
      LEFT JOIN authors a ON p.author_id = a.id
      WHERE p.title LIKE ? OR p.search_content LIKE ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(searchPattern, searchPattern, pageSize, offset)
    .all();

  return c.json({
    success: true,
    data: {
      items: results.results.map((p: Record<string, unknown>) => serializePoem(p)),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    },
  });
});

// Get single poem
poems.get('/:id', async (c) => {
  const id = c.req.param('id');

  const result = await c.env.DB
    .prepare(`
      SELECT p.*, a.name as author_name, a.dynasty as author_dynasty, a.bio as author_bio
      FROM poems p
      LEFT JOIN authors a ON p.author_id = a.id
      WHERE p.id = ?
    `)
    .bind(id)
    .first();

  if (!result) {
    return c.json({ success: false, error: 'Poem not found' }, 404);
  }

  const poem = serializePoem(result as Record<string, unknown>);

  return c.json({
    success: true,
    data: {
      ...poem,
      author: result.author_id
        ? {
            id: result.author_id,
            name: result.author_name,
            dynasty: result.author_dynasty,
            bio: result.author_bio,
          }
        : null,
    },
  });
});
