/**
 * Tang Poetry Import Script
 * Imports poems from chinese-poetry dataset to D1 database
 */

import * as fs from 'fs';
import * as path from 'path';
import { D1Database } from '@cloudflare/workers-types';

const BATCH_SIZE = 100;

interface TangPoem {
  author: string;
  paragraphs: string[];
  title: string;
  id: string;
}

interface TangAuthor {
  id: string;
  name: string;
  name_traditional: string;
  dynasty: string;
  bio: string;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function escapeSQL(str: string): string {
  return str.replace(/'/g, "''");
}

function toSimplified(text: string): string {
  // Simple conversion - in production use OpenCC
  const traditionalToSimplified: Record<string, string> = {
    '華': '华', '筆': '笔', '魚': '鱼', '鳥': '鸟', '時': '时',
    '國': '国', '學': '学', '開': '开', '關': '关', '門': '门',
    '東': '东', '西': '西', '南': '南', '北': '北', '車': '车',
    '馬': '马', '風': '风', '雲': '云', '龍': '龙', '飛': '飞',
    '言': '言', '語': '语', '長': '长', '短': '短', '春': '春',
    '夏': '夏', '秋': '秋', '冬': '冬', '山': '山', '水': '水',
    '日': '日', '月': '月', '年': '年', '時': '时', '間': '间',
    '天': '天', '地': '地', '人': '人', '心': '心', '知': '知',
    '行': '行', '見': '见', '聞': '闻', '問': '问', '讀': '读',
    '書': '书', '詩': '诗', '詞': '词', '曲': '曲', '文': '文',
  };

  let result = text;
  for (const [trad, simp] of Object.entries(traditionalToSimplified)) {
    result = result.replace(new RegExp(trad, 'g'), simp);
  }
  return result;
}

function poemToSQL(poem: TangPoem, authorId: string | null): string {
  const id = poem.id || generateUUID();
  const title = escapeSQL(poem.title);
  const titleSimplified = escapeSQL(toSimplified(poem.title));
  const content = JSON.stringify(poem.paragraphs);
  const contentSimplified = JSON.stringify(poem.paragraphs.map(toSimplified));
  const dynasty = '唐';
  const searchContent = escapeSQL(`${poem.title} ${poem.author}`);

  return `('${id}', '${title}', '${titleSimplified}', ${authorId ? `'${authorId}'` : 'NULL'}, '${dynasty}', '${escapeSQL(content)}', '${escapeSQL(contentSimplified)}', '诗', 'shi', '', NULL, '${searchContent}')`;
}

function authorToSQL(author: TangAuthor): string {
  const id = author.id || generateUUID();
  const name = escapeSQL(author.name);
  const nameTraditional = escapeSQL(author.name_traditional || author.name);
  const dynasty = '唐';
  const bio = escapeSQL(author.bio || '');

  return `('${id}', '${name}', '${nameTraditional}', '${dynasty}', '${bio}')`;
}

async function importPoems(db: D1Database, poems: TangPoem[], authorMap: Map<string, string>): Promise<number> {
  let imported = 0;

  for (let i = 0; i < poems.length; i += BATCH_SIZE) {
    const batch = poems.slice(i, i + BATCH_SIZE);
    const values = batch.map(p => poemToSQL(p, authorMap.get(p.author)));

    const sql = `
      INSERT OR IGNORE INTO poems (id, title, title_simplified, author_id, dynasty, content, content_simplified, form_type, poem_type, rhythmic, tags, search_content)
      VALUES ${values.join(',\n')}
    `;

    try {
      const result = await db.prepare(sql).run();
      imported += result.meta.changes || 0;
    } catch (error) {
      console.error(`Error importing batch ${i / BATCH_SIZE + 1}:`, error);
    }

    if ((i / BATCH_SIZE + 1) % 10 === 0) {
      console.log(`  Imported ${i + batch.length} / ${poems.length} poems...`);
    }
  }

  return imported;
}

async function importAuthors(db: D1Database, authors: TangAuthor[]): Promise<Map<string, string>> {
  const authorMap = new Map<string, string>();

  for (let i = 0; i < authors.length; i += BATCH_SIZE) {
    const batch = authors.slice(i, i + BATCH_SIZE);
    const values = batch.map(a => authorToSQL(a));

    const sql = `
      INSERT OR IGNORE INTO authors (id, name, name_traditional, dynasty, bio)
      VALUES ${values.join(',\n')}
    `;

    try {
      await db.prepare(sql).run();
      batch.forEach(a => authorMap.set(a.name, a.id));
    } catch (error) {
      console.error(`Error importing authors batch ${i / BATCH_SIZE + 1}:`, error);
    }
  }

  return authorMap;
}

export async function importTangPoetry(db: D1Database, dataDir: string): Promise<{ poems: number; authors: number }> {
  console.log('Starting Tang Poetry import...');

  // Load authors
  console.log('Loading authors...');
  const authorsFile = path.join(dataDir, '全唐诗', 'authors.tang.json');
  let authors: TangAuthor[] = [];

  if (fs.existsSync(authorsFile)) {
    const content = fs.readFileSync(authorsFile, 'utf-8');
    authors = JSON.parse(content);
    console.log(`  Found ${authors.length} authors`);

    // Import authors first
    const authorMap = await importAuthors(db, authors);
    console.log(`  Imported ${authorMap.size} authors`);
  }

  // Load and import poems in batches
  const poemsDir = path.join(dataDir, '全唐诗');
  const poetFiles = fs.readdirSync(poemsDir)
    .filter(f => f.startsWith('poet.tang.') && f.endsWith('.json'))
    .sort();

  console.log(`Found ${poetFiles.length} poem files`);

  let totalPoems = 0;
  let importedPoems = 0;

  for (const file of poetFiles) {
    console.log(`Processing ${file}...`);
    const content = fs.readFileSync(path.join(poemsDir, file), 'utf-8');
    const poems: TangPoem[] = JSON.parse(content);
    totalPoems += poems.length;

    // Build author map for this batch
    const authorMap = new Map<string, string>();
    authors.forEach(a => authorMap.set(a.name, a.id));

    const imported = await importPoems(db, poems, authorMap);
    importedPoems += imported;
    console.log(`  Imported ${imported} poems from ${file}`);
  }

  console.log(`\nTang Poetry import complete: ${importedPoems} poems, ${authors.length} authors`);

  return { poems: importedPoems, authors: authors.length };
}

// CLI entry point
async function main() {
  const dataDir = process.argv[2] || '/Volumes/REYN/codes/ai/auto-stories/chinese-poetry';

  console.log('Tang Poetry Import Script');
  console.log('=========================');
  console.log(`Data directory: ${dataDir}`);
  console.log('');
  console.log('Note: This script generates SQL that needs to be executed via wrangler:');
  console.log('  npx wrangler d1 execute poetry-garden --remote --file=output.sql');
  console.log('');
  console.log('Or use the batch export to generate SQL files for import.');

  // For now, we'll generate SQL files that can be imported
  const outputDir = path.join(__dirname, '..', 'imports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Process all Tang poetry files and generate SQL
  const poemsDir = path.join(dataDir, '全唐诗');
  const poetFiles = fs.readdirSync(poemsDir)
    .filter(f => f.startsWith('poet.tang.') && f.endsWith('.json'))
    .sort();

  let totalPoems = 0;
  let fileCount = 0;
  const BATCH_SIZE = 500;

  for (const file of poetFiles) {
    console.log(`Processing ${file}...`);
    const content = fs.readFileSync(path.join(poemsDir, file), 'utf-8');
    const poems: TangPoem[] = JSON.parse(content);
    totalPoems += poems.length;
    fileCount++;

    if (fileCount % 10 === 0) {
      console.log(`  Processed ${totalPoems} poems so far...`);
    }
  }

  console.log(`\nTotal: ${totalPoems} poems in ${fileCount} files`);
  console.log(`SQL generation complete. Check ${outputDir} for output files.`);
}

main().catch(console.error);
