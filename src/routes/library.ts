import { Hono } from 'hono';
import { cachePublic, pageParams, paginated, readR2Json, serializeNode, serializeParagraph } from './helpers';

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
}

export const library = new Hono<{ Bindings: Env }>();

library.get('/collections', async (c) => {
  const type = c.req.query('type');
  const rows = await readR2Json<Record<string, unknown>[]>(c.env.CONTENT, 'catalog/collections/all.json');
  const data = type ? (rows || []).filter((row) => row.type === type) : rows || [];
  cachePublic(c, 300, 3600);
  return c.json({ success: true, data });
});

library.get('/collections/:id', async (c) => {
  const id = c.req.param('id');
  const data = await readR2Json<Record<string, unknown>>(c.env.CONTENT, `catalog/collections/${id}.json`);
  if (!data) return c.json({ success: false, error: 'Collection not found' }, 404);
  cachePublic(c, 300, 86400);
  return c.json({ success: true, data: { ...(data.collection as Record<string, unknown>), root_nodes: data.root_nodes || [] } });
});

library.get('/collections/:id/tree', async (c) => {
  const id = c.req.param('id');
  const data = await readR2Json<Record<string, unknown>>(c.env.CONTENT, `catalog/collections/${id}/tree.json`);
  if (!data) return c.json({ success: false, error: 'Collection not found' }, 404);
  cachePublic(c, 300, 86400);
  return c.json({ success: true, data });
});

library.get('/nodes/:id', async (c) => {
  const node = await readR2Json<Record<string, unknown>>(c.env.CONTENT, `nodes/${c.req.param('id')}.json`);
  if (!node) return c.json({ success: false, error: 'Node not found' }, 404);
  cachePublic(c, 300, 86400);
  return c.json({
    success: true,
    data: {
      ...serializeNode(node),
      children: (node.children as Record<string, unknown>[] || []).map((row) => serializeNode(row)),
      paragraphs: (node.paragraphs as Record<string, unknown>[] || []).map((row) => serializeParagraph(row)),
    },
  });
});

library.get('/paragraphs', async (c) => {
  const { page, pageSize } = pageParams((name) => c.req.query(name));
  cachePublic(c, 300, 3600);
  return c.json({ success: true, data: paginated([], 0, page, pageSize) });
});
