import { Hono, type Context } from 'hono';
import { cachePublic, encodeCatalogSegment, pageParams, readAuthorCatalogSlice, readCatalogSlice, readR2Json } from './helpers';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
}

type CompactContext = Context<{ Bindings: Env }>;

export const compact = new Hono<{ Bindings: Env }>();

// Fields the compact endpoint returns. Smaller than the full WorkSummary so
// listing-page payloads stay small (5-10x reduction) and R2 class-B reads stay
// under the Cloudflare free-tier cap.
const COMPACT_KEYS = [
  'id',
  'title_traditional',
  'author_id',
  'author_name_traditional',
  'dynasty',
  'genre',
  'preview_traditional',
  'popularity_score',
] as const;

type CompactWork = {
  id: string;
  title_traditional: string | null;
  author_id: string | null;
  author_name_traditional: string | null;
  dynasty: string | null;
  genre: string;
  preview_traditional: string;
  popularity_score?: number;
};

function project(row: Record<string, unknown>): CompactWork {
  const out: Partial<CompactWork> = { preview_traditional: '' };
  for (const key of COMPACT_KEYS) {
    (out as Record<string, unknown>)[key] = (row as Record<string, unknown>)[key] ?? null;
  }
  if (typeof out.preview_traditional !== 'string') {
    out.preview_traditional = '';
  }
  return out as CompactWork;
}

function projectItems<T extends Record<string, unknown>>(rows: T[]): CompactWork[] {
  return rows.map(project);
}

async function readWorksByIds(bucket: R2Bucket, ids: string[]): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  // Deduplicate first to avoid double R2 round-trips.
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  for (const id of uniqueIds) {
    const shard = await readR2Json<Record<string, Record<string, unknown>>>(bucket, `works-shards/${id.slice(0, 2)}.json`);
    const work = shard?.[id];
    if (work && !seen.has(id)) {
      seen.add(id);
      out.push(work);
    }
  }
  return out;
}

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

function compactList(c: CompactContext, cacheEdge: number = 3600) {
  const idsParam = c.req.query('ids');
  if (idsParam) {
    // Bulk lookup for shelves / collection lists. Each id reads its own R2
    // shard (256-key id-prefix fan-out). 128 unique ids is the documented cap
    // to keep R2 class-B usage predictable; callers that need more should page
    // through /works first.
    const ids = idsParam.split(',').slice(0, 128);
    return readWorksByIds(c.env.CONTENT, ids).then((rows) => {
      cachePublic(c, 60, 300);
      return {
        success: true,
        data: {
          items: projectItems(rows),
          total: rows.length,
          page: 1,
          page_size: rows.length,
          total_pages: 1,
        },
      };
    });
  }

  const { page, pageSize } = pageParams((name) => c.req.query(name));
  const authorId = c.req.query('author_id');
  const rowsPromise = authorId
    ? readAuthorCatalogSlice<Record<string, unknown>>(c.env.CONTENT, authorId, page, pageSize)
    : readCatalogSlice<Record<string, unknown>>(c.env.CONTENT, catalogPrefix((name) => c.req.query(name)), page, pageSize);
  return rowsPromise.then((data) => {
    cachePublic(c, 300, cacheEdge);
    return {
      success: true,
      data: {
        ...data,
        items: projectItems(data.items as Record<string, unknown>[]),
      },
    };
  });
}

async function compactListHandler(c: CompactContext) {
  return c.json(await compactList(c));
}

// Register under both '' and '/' so the path matches whether or not the
// caller appends a trailing slash (Hono sub-router plus app.route behaviour
// treats them as distinct routes).
compact.get('/', compactListHandler);
compact.get('', compactListHandler);

compact.get('/popular', async (c) => {
  const { page, pageSize } = pageParams((name) => c.req.query(name));
  const authorId = c.req.query('author_id');
  if (authorId) {
    const shard = await readR2Json<Record<string, Record<string, unknown>[]>>(c.env.CONTENT, `catalog/rank/author-shards/${authorId.slice(0, 2)}.json`);
    const rows = shard?.[authorId] || [];
    const offset = (page - 1) * pageSize;
    cachePublic(c, 300, 3600);
    return c.json({
      success: true,
      data: {
        items: projectItems(rows.slice(offset, offset + pageSize)),
        total: rows.length,
        page,
        page_size: pageSize,
        total_pages: Math.ceil(rows.length / pageSize),
      },
    });
  }
  const kind = c.req.query('kind') || c.req.query('type') || 'works';
  const allowed = new Set(['works', 'poetry', 'ci', 'intro']);
  const prefix = `catalog/popular/${allowed.has(kind) ? kind : 'works'}`;

  // Optional deterministic shuffle (?shuffle=12345). The full popular
  // slice is 200 items; if the caller passes shuffle we deterministically
  // pick a contiguous window of `pageSize` so each visitor sees a
  // different top-N while still caching aggressively at the edge.
  const shuffle = c.req.query('shuffle');
  const data = await readCatalogSlice<Record<string, unknown>>(c.env.CONTENT, prefix, page, pageSize);
  let items = data.items as Record<string, unknown>[];
  if (shuffle && items.length > pageSize) {
    const seed = Number(shuffle);
    if (Number.isFinite(seed) && seed >= 0) {
      const stride = Math.max(1, Math.floor(items.length / pageSize));
      const offset = (seed * stride) % Math.max(1, items.length - pageSize + 1);
      items = items.slice(offset, offset + pageSize);
      if (items.length < pageSize) {
        // top up from the front so the response is always full
        items = items.concat((data.items as Record<string, unknown>[]).slice(0, pageSize - items.length));
      }
    }
  }

  cachePublic(c, 300, 3600);
  return c.json({
    success: true,
    data: {
      ...data,
      items: projectItems(items),
      // We don't claim `total` because the slice is now a personalized
      // window, not a stable count of "popular poems".
      total: items.length,
    },
  });
});

export default compact;
