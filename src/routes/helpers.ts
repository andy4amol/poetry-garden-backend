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

export function serializeWork(row: Record<string, unknown>) {
  return {
    ...row,
    content_traditional: parseJsonField(row.content_traditional, []),
    content_simplified: parseJsonField(row.content_simplified, []),
    notes: parseJsonField(row.notes, null),
    tags: parseJsonField(row.tags, []),
    metadata: parseJsonField(row.metadata, {}),
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
    notes: parseJsonField(row.notes, null),
    metadata: parseJsonField(row.metadata, {}),
  };
}
