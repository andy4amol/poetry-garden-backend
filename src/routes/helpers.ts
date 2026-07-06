export function parseJsonField(value: unknown, fallback: unknown = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function pageParams(query: (name: string) => string | undefined) {
  const page = Math.max(1, parseInt(query('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(query('page_size') || '20', 10)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

export function cachePublic(c: { header: (name: string, value: string) => void }, browserSeconds = 300, edgeSeconds = 3600) {
  c.header('Cache-Control', `public, max-age=${browserSeconds}, s-maxage=${edgeSeconds}`);
}

export async function readR2Json<T>(bucket: R2Bucket, key?: unknown): Promise<T | null> {
  if (!key || typeof key !== 'string') return null;
  const object = await bucket.get(key);
  if (!object) return null;
  return object.json<T>();
}

export function encodeCatalogSegment(value: unknown) {
  return encodeURIComponent(String(value || '_')).replace(/%/g, '~');
}

export async function readCatalogPage<T>(bucket: R2Bucket, prefix: string, page: number) {
  const key = `${prefix}/page-${String(page).padStart(5, '0')}.json`;
  return readR2Json<{
    items: T[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  }>(bucket, key);
}

export async function readCatalogSlice<T>(bucket: R2Bucket, prefix: string, page: number, pageSize: number) {
  const firstOffset = (page - 1) * pageSize;
  const firstCatalogPage = Math.floor(firstOffset / 1000) + 1;
  const first = await readCatalogPage<T>(bucket, prefix, firstCatalogPage);
  if (!first) {
    return { items: [], total: 0, page, page_size: pageSize, total_pages: 0 };
  }

  const catalogPageSize = first.page_size || 1000;
  const actualCatalogPage = Math.floor(firstOffset / catalogPageSize) + 1;
  const catalog = actualCatalogPage === firstCatalogPage ? first : await readCatalogPage<T>(bucket, prefix, actualCatalogPage);
  if (!catalog) {
    return { items: [], total: first.total, page, page_size: pageSize, total_pages: Math.ceil(first.total / pageSize) };
  }

  const firstCatalogOffset = firstOffset % catalogPageSize;
  const items = catalog.items.slice(firstCatalogOffset, firstCatalogOffset + pageSize);
  if (items.length < pageSize && actualCatalogPage < catalog.total_pages) {
    const second = await readCatalogPage<T>(bucket, prefix, actualCatalogPage + 1);
    if (second) items.push(...second.items.slice(0, pageSize - items.length));
  }

  return {
    items,
    total: catalog.total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(catalog.total / pageSize),
  };
}

export async function readAuthorCatalogSlice<T>(bucket: R2Bucket, authorId: string, page: number, pageSize: number) {
  const shard = await readR2Json<Record<string, T[]>>(bucket, `catalog/works/author-shards/${authorId.slice(0, 2)}.json`);
  const rows = shard?.[authorId] || [];
  const offset = (page - 1) * pageSize;
  return paginated(rows.slice(offset, offset + pageSize), rows.length, page, pageSize);
}

export function serializeWork(row: Record<string, unknown>) {
  return {
    ...row,
    content_traditional: parseJsonField(row.content_traditional, row.preview_traditional ? [row.preview_traditional] : []),
    content_simplified: parseJsonField(row.content_simplified, row.preview_simplified ? [row.preview_simplified] : []),
    notes: parseJsonField(row.notes, null),
    tags: parseJsonField(row.tags, []),
    metadata: parseJsonField(row.metadata, {}),
  };
}

export function serializeWorkSummary(row: Record<string, unknown>) {
  return {
    ...row,
    content_traditional: parseJsonField(row.content_traditional, row.preview_traditional ? [row.preview_traditional] : []),
    content_simplified: parseJsonField(row.content_simplified, row.preview_simplified ? [row.preview_simplified] : []),
    tags: parseJsonField(row.tags, []),
  };
}

export function serializeNode(row: Record<string, unknown>) {
  return {
    ...row,
    metadata: parseJsonField(row.metadata, {}),
  };
}

export function serializeParagraph(row: Record<string, unknown>) {
  return {
    ...row,
    text_traditional: row.text_traditional || row.preview_traditional || '',
    text_simplified: row.text_simplified || row.preview_simplified || '',
    notes: parseJsonField(row.notes, null),
    metadata: parseJsonField(row.metadata, {}),
  };
}
