import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { poems } from './routes/poems';
import { authors } from './routes/authors';
import { auth } from './routes/auth';
import { collections } from './routes/collections';
import { convert } from './routes/convert';
import { works } from './routes/works';
import { library } from './routes/library';
import { search } from './routes/search';
import { compact } from './routes/compact';
import insights from './routes/insights';
import { readR2Json } from './routes/helpers';

interface Bindings {
  DB: D1Database;
  CONTENT: R2Bucket;
  JWT_SECRET: string;
  MINIMAX_API_KEY: string;
  MINIMAX_BASE_URL?: string;
  MINIMAX_MODEL?: string;
  API_VERSION: string;
}

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Normalize trailing slashes: redirect /api/works/ -> /api/works so Hono's
// sub-router routes (which mount at exact paths, no trailing slash) match.
// Without this, callers that hit /api/compact/works (no slash) bypass the
// compact sub-router and fall through to the 404 handler.
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path !== '/' && path.endsWith('/')) {
    const trimmed = path.replace(/\/+$/, '');
    const suffix = c.req.url.slice(c.req.path.length);
    return c.redirect(trimmed + suffix, 301);
  }
  await next();
});

// Response helper
const json = (data: unknown, success = true, message?: string) => {
  return Response.json({ success, data, message });
};

// Health check
app.get('/api/health', (c) => {
  return json({ version: c.env.API_VERSION || '1.0.0', status: 'ok' });
});

app.get('/api/dynasties', async (c) => {
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  const data = await readR2Json<{ id: number; name: string; name_zh: string }[]>(c.env.CONTENT, 'catalog/dynasties/all.json');
  if (data?.length) return c.json({ success: true, data });

  return c.json({
    success: true,
    data: [
      { id: 1, name: 'Tang', name_zh: '唐代' },
      { id: 2, name: 'Song', name_zh: '宋代' },
      { id: 3, name: 'Yuan', name_zh: '元代' },
      { id: 4, name: 'Ming', name_zh: '明代' },
      { id: 5, name: 'Qing', name_zh: '清代' },
    ],
  });
});

// Routes
app.route('/api/poems', poems);
app.route('/api/works', works);
app.route('/api/compact/works', compact);
app.route('/api/insights', insights);
app.route('/api/library', library);
app.route('/api/search', search);
app.route('/api/authors', authors);
app.route('/api/auth', auth);
app.route('/api/collections', collections);
app.route('/api/convert', convert);

// Fallback
app.notFound((c) => {
  return c.json({ success: false, data: { error: 'Not found' }, message: 'Endpoint not found' }, 404);
});

app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ success: false, data: { error: err.message }, message: 'Internal server error' }, 500);
});

export default app;
