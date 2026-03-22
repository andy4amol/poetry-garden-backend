import { Hono } from 'hono';

interface Env {
  DB: D1Database;
}

export const auth = new Hono<{ Bindings: Env }>();

// Simple hash function (in production, use proper bcrypt)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Register
auth.post('/register', async (c) => {
  const { email, password, display_name } = await c.req.json();

  if (!email || !password) {
    return c.json({ success: false, error: 'Email and password required' }, 400);
  }

  // Check if user exists
  const existing = await c.env.DB
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (existing) {
    return c.json({ success: false, error: 'Email already registered' }, 409);
  }

  const id = crypto.randomUUID();
  const passwordHash = simpleHash(password);

  await c.env.DB
    .prepare(`
      INSERT INTO users (id, email, password_hash, display_name)
      VALUES (?, ?, ?, ?)
    `)
    .bind(id, email, passwordHash, display_name || email.split('@')[0])
    .run();

  // Generate a simple token (in production, use proper JWT)
  const token = simpleHash(`${id}:${Date.now()}`);

  return c.json({
    success: true,
    data: {
      id,
      email,
      display_name: display_name || email.split('@')[0],
      preference_charset: 'traditional',
      preference_pinyin: false,
      preference_font_size: 18,
    },
    token,
  });
});

// Login
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json();

  if (!email || !password) {
    return c.json({ success: false, error: 'Email and password required' }, 400);
  }

  const user = await c.env.DB
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user) {
    return c.json({ success: false, error: 'Invalid credentials' }, 401);
  }

  const passwordHash = simpleHash(password);
  if (user.password_hash !== passwordHash) {
    return c.json({ success: false, error: 'Invalid credentials' }, 401);
  }

  // Generate token
  const token = simpleHash(`${user.id}:${Date.now()}`);

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      preference_charset: user.preference_charset,
      preference_pinyin: Boolean(user.preference_pinyin),
      preference_font_size: user.preference_font_size,
    },
    token,
  });
});

// Get current user profile
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ success: false, error: 'No token provided' }, 401);
  }

  // Simple token verification (extract user id from token)
  // In production, use proper JWT verification
  const token = authHeader.replace('Bearer ', '');

  // For demo, we'll skip actual token verification
  // and just return a mock user
  return c.json({
    success: true,
    data: {
      id: 'demo-user',
      email: 'user@example.com',
      display_name: 'Demo User',
      preference_charset: 'traditional',
      preference_pinyin: false,
      preference_font_size: 18,
    },
  });
});
