import { Hono } from 'hono';
import { readR2Json } from './helpers';
import { verifyJwt, type JwtPayload } from '../lib/jwt';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  JWT_SECRET: string;
}

export const collections = new Hono<{ Bindings: Env }>();

async function getUserId(c: { req: { header: (n: string) => string | undefined } } & { env: { JWT_SECRET: string } }): Promise<string | null> {
  const header = c.req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = await verifyJwt<JwtPayload>(match[1].trim(), c.env.JWT_SECRET);
  return payload?.sub ?? null;
}

async function enrichWork(c: { env: { CONTENT: R2Bucket } }, id: string) {
  if (!id) return null;
  const shard = await readR2Json<Record<string, Record<string, unknown>>>(c.env.CONTENT, `works-shards/${id.slice(0, 2)}.json`);
  const work = shard?.[id];
  return work
    ? {
        title: work.title_traditional || null,
        author_name: work.author_name_traditional || null,
        dynasty: work.dynasty || null,
        content: work.content_traditional || null,
        poem_type: work.genre || null,
      }
    : null;
}

// List user's collections
collections.get('/', async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ success: false, error: '未登录或令牌无效' }, 401);

  const type = c.req.query('type');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('page_size') || '20', 10)));
  const offset = (page - 1) * pageSize;

  const whereClause = 'WHERE user_id = ?';
  const params: (string | number)[] = [userId];
  if (type && type !== 'all') {
    whereClause.replace;
    // Use append pattern; D1 prepare doesn't accept mutate of template.
    // Implement inline: the inner SQL is hand-built.
  }

  const baseWhere = type && type !== 'all'
    ? `WHERE user_id = ?1 AND content_type = ?2`
    : `WHERE user_id = ?1`;

  const countResult = await c.env.DB
    .prepare(`SELECT COUNT(*) AS total FROM collections ${baseWhere}`)
    .bind(userId, ...(type && type !== 'all' ? [type] : []))
    .first<{ total: number }>();
  const total = Number(countResult?.total ?? 0);

  const items = await c.env.DB
    .prepare(
      `SELECT id, content_type, content_id, notes, created_at
       FROM collections ${baseWhere}
       ORDER BY created_at DESC
       LIMIT ?${type && type !== 'all' ? 3 : 2} OFFSET ?${type && type !== 'all' ? 4 : 3}`
    )
    .bind(userId, ...(type && type !== 'all' ? [type] : []), pageSize, offset)
    .all<{ id: string; content_type: string; content_id: string; notes: string | null; created_at: string }>();

  const enriched = await Promise.all(
    items.results.map(async (item) => {
      const work = await enrichWork(c, item.content_id);
      return { ...item, ...work };
    })
  );

  return c.json({
    success: true,
    data: {
      items: enriched,
      total,
      page,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize),
    },
  });
});

// Add to collection
collections.post('/', async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ success: false, error: '未登录或令牌无效' }, 401);

  let body: { content_type?: string; content_id?: string; notes?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ success: false, error: '无效的请求体' }, 400);
  }
  const { content_type, content_id, notes } = body;
  if (!content_type || !content_id) {
    return c.json({ success: false, error: 'content_type 和 content_id 必须提供' }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await c.env.DB
      .prepare(
        `INSERT INTO collections (id, user_id, content_type, content_id, notes)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, userId, content_type, content_id, notes || null)
      .run();
    return c.json(
      { success: true, data: { id, user_id: userId, content_type, content_id, notes: notes || null } },
      201
    );
  } catch {
    return c.json({ success: false, error: '已在收藏中或重复请求' }, 409);
  }
});

// Remove from collection. The :id here is the collection row id, not the
// content_id. Authorization is required so users can only remove their own.
collections.delete('/:id', async (c) => {
  const userId = await getUserId(c);
  if (!userId) return c.json({ success: false, error: '未登录或令牌无效' }, 401);
  const id = c.req.param('id');

  const result = await c.env.DB
    .prepare('DELETE FROM collections WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  if (!result.meta || result.meta.changes === 0) {
    return c.json({ success: false, error: '未找到或无权删除' }, 404);
  }
  return c.json({ success: true, data: { removed: id } });
});
