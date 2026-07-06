import { Hono } from 'hono';
import { cachePublic, encodeCatalogSegment, pageParams, readAuthorCatalogSlice, readCatalogSlice, readR2Json } from './helpers';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
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

function poemFromWork(work: Record<string, unknown>) {
  return {
    ...work,
    title: work.title_traditional,
    author: work.author_name_traditional || '',
    content: work.content_traditional || [],
    content_simplified: work.content_simplified || [],
    poem_type: work.genre,
  };
}

function prefix(c: { req: { query: (name: string) => string | undefined } }) {
  const genre = c.req.query('poem_type') || c.req.query('type');
  const dynasty = normalizeDynasty(c.req.query('dynasty'));
  const authorId = c.req.query('author_id');
  if (authorId) return `catalog/works/author/${encodeCatalogSegment(authorId)}`;
  if (genre && dynasty) return `catalog/works/genre/${encodeCatalogSegment(genre)}/dynasty/${encodeCatalogSegment(dynasty)}`;
  if (genre) return `catalog/works/genre/${encodeCatalogSegment(genre)}`;
  if (dynasty) return `catalog/works/dynasty/${encodeCatalogSegment(dynasty)}`;
  return 'catalog/works/all';
}

poems.get('/', async (c) => {
  const q = c.req.query('q') || c.req.query('search');
  if (q) return c.redirect(`/api/search?q=${encodeURIComponent(q)}&page=${c.req.query('page') || '1'}`, 307);
  const { page, pageSize } = pageParams((name) => c.req.query(name));
  const authorId = c.req.query('author_id');
  const data = authorId
    ? await readAuthorCatalogSlice<Record<string, unknown>>(c.env.CONTENT, authorId, page, pageSize)
    : await readCatalogSlice<Record<string, unknown>>(c.env.CONTENT, prefix(c), page, pageSize);
  cachePublic(c, 300, 3600);
  return c.json({ success: true, data: { ...data, items: data.items.map(poemFromWork) } });
});

poems.get('/search', async (c) => c.redirect(`/api/search?q=${encodeURIComponent(c.req.query('q') || c.req.query('search') || '')}&page=${c.req.query('page') || '1'}`, 307));

poems.get('/random', async (c) => {
  const ids = await readR2Json<string[]>(c.env.CONTENT, 'catalog/random/work-ids.json');
  if (!ids?.length) return c.json({ success: false, error: 'No poems found' }, 404);
  const id = ids[crypto.getRandomValues(new Uint32Array(1))[0] % ids.length];
  const shard = await readR2Json<Record<string, Record<string, unknown>>>(c.env.CONTENT, `works-shards/${id.slice(0, 2)}.json`);
  const work = shard?.[id];
  cachePublic(c, 60, 300);
  return c.json({ success: true, data: work ? poemFromWork(work) : null });
});

poems.get('/:id', async (c) => {
  const id = c.req.param('id');
  const shard = await readR2Json<Record<string, Record<string, unknown>>>(c.env.CONTENT, `works-shards/${id.slice(0, 2)}.json`);
  const work = shard?.[id];
  if (!work) return c.json({ success: false, error: 'Poem not found' }, 404);
  cachePublic(c, 300, 86400);
  return c.json({ success: true, data: poemFromWork(work) });
});
