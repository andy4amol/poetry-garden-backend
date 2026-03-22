import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { poems } from './routes/poems';
import { authors } from './routes/authors';
import { auth } from './routes/auth';
import { collections } from './routes/collections';
import { convert } from './routes/convert';

const app = new Hono();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Response helper
const json = (data: unknown, success = true, message?: string) => {
  return Response.json({ success, data, message });
};

// Health check
app.get('/api/health', (c) => {
  return json({ version: c.env.API_VERSION || '1.0.0', status: 'ok' });
});

// Routes
app.route('/api/poems', poems);
app.route('/api/authors', authors);
app.route('/api/auth', auth);
app.route('/api/collections', collections);
app.route('/api/convert', convert);

// Fallback
app.notFound((c) => {
  return json({ error: 'Not found' }, false, 'Endpoint not found');
});

app.onError((c, err) => {
  console.error('Error:', err);
  return json({ error: err.message }, false, 'Internal server error');
});

export default app;
