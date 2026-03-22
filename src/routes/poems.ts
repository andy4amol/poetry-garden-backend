import { Hono } from 'hono';
import { z } from 'zod';

interface Env {
  DB: D1Database;
}

export const poems = new Hono<{ Bindings: Env }>();

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
  const dynasty = c.req.query('dynasty');
  const poemType = c.req.query('poem_type');
  const authorId = c.req.query('author_id');
  const search = c.req.query('search') || c.req.query('q');

  const offset = (page - 1) * pageSize;

  let whereClause = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (dynasty) {
    whereClause += ' AND dynasty = ?';
    params.push(dynasty);
  }
  if (poemType) {
    whereClause += ' AND poem_type = ?';
    params.push(poemType);
  }
  if (authorId) {
    whereClause += ' AND author_id = ?';
    params.push(authorId);
  }
  if (search) {
    whereClause += ' AND (title LIKE ? OR search_content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  // Get total count
  const countResult = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM poems ${whereClause}`)
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
      items: items.results.map((p: Record<string, unknown>) => {
        let content = p.content as string;
        if (content) {
          try {
            content = JSON.parse(content);
          } catch {
            content = (content as string).split('\\n');
          }
        } else {
          content = [];
        }
        let tags = p.tags ? (p.tags as string) : '[]';
        try {
          tags = JSON.parse(tags as string);
        } catch {
          tags = [];
        }
        return {
          ...p,
          content,
          tags,
        };
      }),
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

  let content = firstResult.content as string;
  if (content) {
    try {
      content = JSON.parse(content);
    } catch {
      content = (content as string).split('\\n');
    }
  } else {
    content = [];
  }

  return c.json({
    success: true,
    data: {
      ...firstResult,
      content,
    },
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
      items: results.results.map((p: Record<string, unknown>) => {
        let content = p.content as string;
        if (content) {
          try {
            content = JSON.parse(content);
          } catch {
            content = (content as string).split('\\n');
          }
        } else {
          content = [];
        }
        return { ...p, content };
      }),
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

  // Handle content - can be JSON array string or plain text with newlines
  let content = result.content as string;
  if (content) {
    try {
      content = JSON.parse(content);
    } catch {
      // If not valid JSON, treat as newline-separated text
      content = content.split('\\n');
    }
  } else {
    content = [];
  }

  let contentSimplified = result.content_simplified as string | null;
  if (contentSimplified) {
    try {
      contentSimplified = JSON.parse(contentSimplified);
    } catch {
      contentSimplified = (contentSimplified as string).split('\\n');
    }
  }

  let tags = result.tags ? (result.tags as string) : '[]';
  try {
    tags = JSON.parse(tags);
  } catch {
    tags = [];
  }

  return c.json({
    success: true,
    data: {
      ...result,
      content,
      content_simplified: contentSimplified,
      tags,
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
