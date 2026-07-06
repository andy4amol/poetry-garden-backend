import { Hono } from 'hono';
import { cachePublic, paginated, readR2Json } from './helpers';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
}

export const authors = new Hono<{ Bindings: Env }>();

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

authors.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(c.req.query('page_size') || '500', 10)));
  const dynasty = normalizeDynasty(c.req.query('dynasty') || c.req.query('dynasty_id'));
  const search = c.req.query('search') || c.req.query('q');
  const rows = await readR2Json<Record<string, unknown>[]>(c.env.CONTENT, 'catalog/authors/all.json');
  let filtered = rows || [];
  if (dynasty) filtered = filtered.filter((row) => row.dynasty === dynasty);
  if (search) filtered = filtered.filter((row) => `${row.name_traditional || ''} ${row.name_simplified || ''}`.includes(search));
  const offset = (page - 1) * pageSize;
  cachePublic(c, 300, 3600);
  return c.json({ success: true, data: paginated(filtered.slice(offset, offset + pageSize), filtered.length, page, pageSize) });
});

authors.get('/:id', async (c) => {
  const rows = await readR2Json<Record<string, unknown>[]>(c.env.CONTENT, 'catalog/authors/all.json');
  const author = (rows || []).find((row) => row.id === c.req.param('id'));
  if (!author) return c.json({ success: false, error: 'Author not found' }, 404);
  cachePublic(c, 300, 86400);
  return c.json({ success: true, data: author });
});
