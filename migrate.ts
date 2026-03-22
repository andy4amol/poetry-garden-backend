/**
 * Data Migration Script
 * Migrates data from PostgreSQL to Cloudflare D1
 *
 * Usage:
 * 1. Export data from PostgreSQL to JSON
 * 2. Run: npx wrangler d1 execute poetry-garden --file=./schema.sql
 * 3. Run: npx tsx migrate.ts
 */

import { D1Database } from '@cloudflare/workers-types';

// Mock D1 client for local development
// In production, use wrangler d1 commands

interface Author {
  id: string;
  name: string;
  name_traditional: string | null;
  dynasty: string;
  bio: string | null;
}

interface Poem {
  id: string;
  title: string;
  title_simplified: string | null;
  author_id: string | null;
  dynasty: string;
  content: string; // JSON array
  content_simplified: string | null;
  form_type: string | null;
  poem_type: string;
  rhythmic: string | null;
  tags: string | null; // JSON array
  source_file: string | null;
  source_id: string | null;
}

// Sample data for initial seeding
const sampleAuthors: Author[] = [
  { id: 'li_bai', name: '李白', dynasty: '唐', bio: '唐代伟大的浪漫主义诗人' },
  { id: 'du_fu', name: '杜甫', dynasty: '唐', bio: '唐代现实主义诗人' },
  { id: 'wang_wei', name: '王维', dynasty: '唐', bio: '唐代山水田园诗人' },
  { id: 'su_shi', name: '苏轼', dynasty: '宋', bio: '北宋文学家' },
  { id: 'li_qingzhao', name: '李清照', dynasty: '宋', bio: '宋代女词人' },
];

const samplePoems: Poem[] = [
  {
    id: 'jing_ye_si',
    title: '静夜思',
    title_simplified: '静夜思',
    author_id: 'li_bai',
    dynasty: '唐',
    content: JSON.stringify(['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡']),
    content_simplified: null,
    form_type: '五言绝句',
    poem_type: 'shi',
    rhythmic: null,
    tags: JSON.stringify(['思乡', '夜景']),
    source_file: null,
    source_id: null,
  },
  {
    id: 'wang_li_han',
    title: '望庐山瀑布',
    title_simplified: '望庐山瀑布',
    author_id: 'li_bai',
    dynasty: '唐',
    content: JSON.stringify(['日照香炉生紫烟', '遥看瀑布挂前川', '飞流直下三千尺', '疑是银河落九天']),
    content_simplified: null,
    form_type: '七言绝句',
    poem_type: 'shi',
    rhythmic: null,
    tags: JSON.stringify(['山水', '瀑布']),
    source_file: null,
    source_id: null,
  },
  {
    id: 'chun_jiang',
    title: '春江花月夜',
    title_simplified: '春江花月夜',
    author_id: 'zhang_ru_xu',
    dynasty: '唐',
    content: JSON.stringify(['春江潮水连海平', '海上明月共潮生']),
    content_simplified: null,
    form_type: '七言古诗',
    poem_type: 'shi',
    rhythmic: null,
    tags: JSON.stringify(['夜景', '春天']),
    source_file: null,
    source_id: null,
  },
];

// SQL templates for migration
const INSERT_AUTHOR = `
  INSERT INTO authors (id, name, name_traditional, dynasty, bio)
  VALUES (?, ?, ?, ?, ?)
`;

const INSERT_POEM = `
  INSERT INTO poems (id, title, title_simplified, author_id, dynasty, content, content_simplified, form_type, poem_type, rhythmic, tags, source_file, source_id, search_content)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Migration function - processes data in batches
 */
async function migrateBatch(
  db: D1Database,
  authors: Author[],
  poems: Poem[]
): Promise<void> {
  console.log(`Migrating ${authors.length} authors and ${poems.length} poems...`);

  // Migrate authors
  for (const author of authors) {
    await db
      .prepare(INSERT_AUTHOR)
      .bind(
        author.id,
        author.name,
        author.name_traditional || author.name,
        author.dynasty,
        author.bio || null
      )
      .run();
  }
  console.log('Authors migrated');

  // Migrate poems
  for (const poem of poems) {
    const searchContent = JSON.parse(poem.content).join(' ');
    await db
      .prepare(INSERT_POEM)
      .bind(
        poem.id,
        poem.title,
        poem.title_simplified || poem.title,
        poem.author_id || null,
        poem.dynasty,
        poem.content,
        poem.content_simplified || null,
        poem.form_type || null,
        poem.poem_type,
        poem.rhythmic || null,
        poem.tags || null,
        poem.source_file || null,
        poem.source_id || null,
        searchContent
      )
      .run();
  }
  console.log('Poems migrated');

  console.log('Migration complete!');
}

// Export for use in wrangler commands
export { migrateBatch, sampleAuthors, samplePoems };
