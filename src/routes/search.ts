import { Hono } from 'hono';
import { cachePublic, pageParams, paginated, readR2Json } from './helpers';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
}

export const search = new Hono<{ Bindings: Env }>();

async function searchRows(c: { env: Env }, q: string) {
  const first = [...q.trim()][0];
  if (!first) return [];
  const bucket = (first.codePointAt(0)! % 256).toString(16).padStart(2, '0');
  const rows = await readR2Json<Record<string, unknown>[]>(c.env.CONTENT, `catalog/search-buckets/${bucket}.json`);
  const query = q.toLowerCase();
  return (rows || []).filter((row) => String(row.search_text || '').toLowerCase().includes(query));
}

search.get('/', async (c) => {
  const q = (c.req.query('q') || c.req.query('query') || '').trim();
  const { page, pageSize, offset } = pageParams((name) => c.req.query(name));
  if (!q) return c.json({ success: false, error: 'Search query required' }, 400);

  const rows = await searchRows(c, q);
  const items = rows.slice(offset, offset + pageSize).map((row) => ({
    entity_type: 'work',
    entity_id: row.id,
    title: row.title_traditional,
    author: row.author_name_traditional,
    dynasty: row.dynasty,
    genre: row.genre,
    collection: row.collection_title_traditional,
    collection_slug: row.collection_slug,
    snippet: row.preview_traditional,
  }));

  cachePublic(c, 120, 900);
  return c.json({ success: true, data: paginated(items, rows.length, page, pageSize) });
});

search.get('/suggest', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ success: true, data: [] });
  const rows = await searchRows(c, q);
  cachePublic(c, 120, 900);
  return c.json({ success: true, data: rows.slice(0, 10).map((row) => ({
    entity_type: 'work',
    entity_id: row.id,
    title: row.title_traditional,
    author: row.author_name_traditional,
    dynasty: row.dynasty,
    genre: row.genre,
    collection: row.collection_title_traditional,
    collection_slug: row.collection_slug,
  })) });
});
