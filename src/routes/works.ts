import { Hono } from 'hono';
import { cachePublic, encodeCatalogSegment, pageParams, readAuthorCatalogSlice, readCatalogSlice, readR2Json, serializeWork } from './helpers';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
}

export const works = new Hono<{ Bindings: Env }>();

function catalogPrefix(query: (name: string) => string | undefined) {
  const genre = query('genre') || query('type');
  const dynasty = query('dynasty');
  const authorId = query('author_id');
  const collectionId = query('collection_id');
  const rhythmic = query('rhythmic');

  if (authorId) return `catalog/works/author/${encodeCatalogSegment(authorId)}`;
  if (collectionId) return `catalog/works/collection/${encodeCatalogSegment(collectionId)}`;
  if (rhythmic) return `catalog/works/rhythmic/${encodeCatalogSegment(rhythmic)}`;
  if (genre && dynasty) return `catalog/works/genre/${encodeCatalogSegment(genre)}/dynasty/${encodeCatalogSegment(dynasty)}`;
  if (genre) return `catalog/works/genre/${encodeCatalogSegment(genre)}`;
  if (dynasty) return `catalog/works/dynasty/${encodeCatalogSegment(dynasty)}`;
  return 'catalog/works/all';
}

works.get('/', async (c) => {
  const q = c.req.query('q') || c.req.query('search');
  if (q) {
    const url = new URL(c.req.url);
    url.pathname = '/api/search';
    return c.redirect(`${url.pathname}${url.search}`, 307);
  }

  const { page, pageSize } = pageParams((name) => c.req.query(name));
  const authorId = c.req.query('author_id');
  const data = authorId
    ? await readAuthorCatalogSlice<Record<string, unknown>>(c.env.CONTENT, authorId, page, pageSize)
    : await readCatalogSlice<Record<string, unknown>>(c.env.CONTENT, catalogPrefix((name) => c.req.query(name)), page, pageSize);
  cachePublic(c, 300, 3600);
  return c.json({ success: true, data });
});

works.get('/random', async (c) => {
  const ids = await readR2Json<string[]>(c.env.CONTENT, 'catalog/random/work-ids.json');
  if (!ids?.length) return c.json({ success: false, error: 'Work not found' }, 404);
  const id = ids[crypto.getRandomValues(new Uint32Array(1))[0] % ids.length];
  const shard = await readR2Json<Record<string, Record<string, unknown>>>(c.env.CONTENT, `works-shards/${id.slice(0, 2)}.json`);
  const work = shard?.[id];
  if (!work) return c.json({ success: false, error: 'Work not found' }, 404);
  cachePublic(c, 60, 300);
  return c.json({ success: true, data: serializeWork(work) });
});

works.get('/:id', async (c) => {
  const id = c.req.param('id');
  const shard = await readR2Json<Record<string, Record<string, unknown>>>(c.env.CONTENT, `works-shards/${id.slice(0, 2)}.json`);
  const work = shard?.[id];
  if (!work) return c.json({ success: false, error: 'Work not found' }, 404);
  cachePublic(c, 300, 86400);
  return c.json({ success: true, data: { ...serializeWork(work), paragraphs: [], strains: [] } });
});
