import { Hono } from 'hono';
import { pageParams, paginated, serializeNode, serializeParagraph } from './helpers';

interface Env {
  DB: D1Database;
}

export const library = new Hono<{ Bindings: Env }>();

library.get('/collections', async (c) => {
  const type = c.req.query('type');
  let where = 'WHERE 1=1';
  const params: string[] = [];

  if (type) {
    where += ' AND type = ?';
    params.push(type);
  }

  const rows = await c.env.DB
    .prepare(`
      SELECT * FROM content_collections
      ${where}
      ORDER BY sort_order ASC, title_simplified ASC
    `)
    .bind(...params)
    .all();

  return c.json({ success: true, data: rows.results });
});

library.get('/collections/:id', async (c) => {
  const id = c.req.param('id');
  const collection = await c.env.DB
    .prepare('SELECT * FROM content_collections WHERE id = ? OR slug = ?')
    .bind(id, id)
    .first();

  if (!collection) {
    return c.json({ success: false, error: 'Collection not found' }, 404);
  }

  const rootNodes = await c.env.DB
    .prepare(`
      SELECT * FROM book_nodes
      WHERE collection_id = ? AND parent_id IS NULL
      ORDER BY order_index ASC
    `)
    .bind(collection.id)
    .all();

  return c.json({
    success: true,
    data: {
      ...collection,
      root_nodes: rootNodes.results.map((row) => serializeNode(row as Record<string, unknown>)),
    },
  });
});

library.get('/collections/:id/tree', async (c) => {
  const id = c.req.param('id');
  const collection = await c.env.DB
    .prepare('SELECT * FROM content_collections WHERE id = ? OR slug = ?')
    .bind(id, id)
    .first();

  if (!collection) {
    return c.json({ success: false, error: 'Collection not found' }, 404);
  }

  const rows = await c.env.DB
    .prepare(`
      SELECT * FROM book_nodes
      WHERE collection_id = ?
      ORDER BY parent_id, order_index ASC
    `)
    .bind(collection.id)
    .all();

  return c.json({
    success: true,
    data: {
      collection,
      nodes: rows.results.map((row) => serializeNode(row as Record<string, unknown>)),
    },
  });
});

library.get('/nodes/:id', async (c) => {
  const id = c.req.param('id');
  const node = await c.env.DB
    .prepare(`
      SELECT n.*, c.slug AS collection_slug,
        c.title_simplified AS collection_title_simplified,
        c.title_traditional AS collection_title_traditional
      FROM book_nodes n
      LEFT JOIN content_collections c ON c.id = n.collection_id
      WHERE n.id = ?
    `)
    .bind(id)
    .first();

  if (!node) {
    return c.json({ success: false, error: 'Node not found' }, 404);
  }

  const children = await c.env.DB
    .prepare('SELECT * FROM book_nodes WHERE parent_id = ? ORDER BY order_index ASC')
    .bind(id)
    .all();

  const paragraphs = await c.env.DB
    .prepare('SELECT * FROM paragraphs WHERE node_id = ? ORDER BY order_index ASC')
    .bind(id)
    .all();

  return c.json({
    success: true,
    data: {
      ...serializeNode(node as Record<string, unknown>),
      children: children.results.map((row) => serializeNode(row as Record<string, unknown>)),
      paragraphs: paragraphs.results.map((row) => serializeParagraph(row as Record<string, unknown>)),
    },
  });
});

library.get('/paragraphs', async (c) => {
  const { page, pageSize, offset } = pageParams((name) => c.req.query(name));
  const collectionId = c.req.query('collection_id');
  const nodeId = c.req.query('node_id');

  let where = 'WHERE p.work_id IS NULL';
  const params: (string | number)[] = [];

  if (nodeId) {
    where += ' AND p.node_id = ?';
    params.push(nodeId);
  }
  if (collectionId) {
    where += ' AND n.collection_id = ?';
    params.push(collectionId);
  }

  const count = await c.env.DB
    .prepare(`
      SELECT COUNT(*) AS total
      FROM paragraphs p
      LEFT JOIN book_nodes n ON n.id = p.node_id
      ${where}
    `)
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB
    .prepare(`
      SELECT p.*, n.title_simplified AS node_title_simplified,
        n.title_traditional AS node_title_traditional
      FROM paragraphs p
      LEFT JOIN book_nodes n ON n.id = p.node_id
      ${where}
      ORDER BY n.order_index ASC, p.order_index ASC
      LIMIT ? OFFSET ?
    `)
    .bind(...params, pageSize, offset)
    .all();

  return c.json({
    success: true,
    data: paginated(rows.results.map((row) => serializeParagraph(row as Record<string, unknown>)), count?.total || 0, page, pageSize),
  });
});
