import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { signJwt, verifyJwt, type JwtPayload } from '../lib/jwt';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  JWT_SECRET: string;
}

export const auth = new Hono<{ Bindings: Env }>();

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
}

interface PublicUser {
  id: string;
  email: string;
  username: string;
}

function userToPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.display_name || row.email.split('@')[0],
  };
}

async function readBearer(c: { req: { header: (n: string) => string | undefined } }): Promise<string | null> {
  const header = c.req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

auth.post('/register', async (c) => {
  let body: { email?: string; password?: string; display_name?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ success: false, error: '无效的请求体' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.display_name || '').trim() || email.split('@')[0];

  if (!email || !email.includes('@')) {
    return c.json({ success: false, error: '邮箱格式不正确' }, 400);
  }
  if (password.length < 6) {
    return c.json({ success: false, error: '密码至少 6 位' }, 400);
  }

  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();
  if (existing) return c.json({ success: false, error: '邮箱已被注册' }, 409);

  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(password, 10);
  await c.env.DB
    .prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
    .bind(id, email, hash, displayName)
    .run();

  const token = await signJwt({ sub: id, email }, c.env.JWT_SECRET);
  return c.json({
    success: true,
    data: { token, user: { id, email, username: displayName } },
  });
});

auth.post('/login', async (c) => {
  let body: { email?: string; password?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ success: false, error: '无效的请求体' }, 400);
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return c.json({ success: false, error: '邮箱或密码缺失' }, 400);
  }

  const row = await c.env.DB
    .prepare('SELECT id, email, password_hash, display_name FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>();
  if (!row) return c.json({ success: false, error: '邮箱或密码错误' }, 401);

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return c.json({ success: false, error: '邮箱或密码错误' }, 401);

  const token = await signJwt({ sub: row.id, email: row.email }, c.env.JWT_SECRET);
  return c.json({
    success: true,
    data: { token, user: userToPublic(row) },
  });
});

auth.get('/me', async (c) => {
  const token = await readBearer(c);
  if (!token) return c.json({ success: false, error: '未登录或令牌缺失' }, 401);
  const payload = await verifyJwt<JwtPayload>(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ success: false, error: '令牌无效或过期' }, 401);

  const row = await c.env.DB
    .prepare('SELECT id, email, password_hash, display_name FROM users WHERE id = ?')
    .bind(payload.sub)
    .first<UserRow>();
  if (!row) return c.json({ success: false, error: '用户不存在' }, 404);

  return c.json({ success: true, data: userToPublic(row) });
});

auth.post('/logout', async (c) => {
  // Stateless JWT — the client drops the token. Endpoint exists for symmetry
  // and future server-side revocation lists.
  return c.json({ success: true, data: { ok: true } });
});
