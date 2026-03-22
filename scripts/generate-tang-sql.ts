/**
 * Generate SQL import files from chinese-poetry dataset
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = '/Volumes/REYN/codes/ai/auto-stories/chinese-poetry';
const OUTPUT_DIR = __dirname;

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function escapeSQL(str: string): string {
  if (!str) return '';
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

const TRAD_TO_SIMP: Record<string, string> = {
  '華': '华', '筆': '笔', '魚': '鱼', '鳥': '鸟', '時': '时',
  '國': '国', '學': '学', '開': '开', '關': '关', '門': '门',
  '東': '东', '西': '西', '南': '南', '北': '北', '車': '车',
  '馬': '马', '風': '风', '雲': '云', '龍': '龙', '飛': '飞',
  '長': '长', '間': '间', '鄉': '乡', '復': '复', '說': '说',
  '見': '见', '聞': '闻', '問': '问', '讀': '读', '書': '书',
  '詩': '诗', '詞': '词', '曲': '曲', '萬': '万', '處': '处',
  '來': '来', '來的': '来的', '雲': '云', '興': '兴', '頭': '头',
  '遠': '远', '近': '近', '歸': '归', '遊': '游', '滿': '满',
  '聲': '声', '樂': '乐', '筆': '笔', '帶': '带', '動': '动',
  '對': '对', '園': '园', '樓': '楼', '臺': '台', '飲': '饮',
  '雜': '杂', '變': '变', '難': '难', '麗': '丽', '閑': '闲',
  '關': '关', '觀': '观', '輕': '轻', '鏡': '镜', '憐': '怜',
  '環': '环', '曉': '晓', '暁': '晓', '淚': '泪', '舊': '旧',
  '攜': '携', '搗': '捣', '夢': '梦', '燈': '灯', '獨': '独',
  '聽': '听', '盡': '尽', '織': '织', '辭': '辞', '騰': '腾',
  '疊': '叠', '隱': '隐', '顯': '显', '靜': '静', '響': '响',
  '香': '香', '馳': '驰', '驅': '驱', '鮑': '鲍', '鮮': '鲜',
  '鸞': '鸾', '鶴': '鹤', '鸞': '鸾', '麥': '麦', '黃': '黄',
  '黑': '黑', '點': '点', '齋': '斋', '龍': '龙', '龜': '龟',
};

function toSimplified(text: string): string {
  if (!text) return '';
  let result = text;
  for (const [trad, simp] of Object.entries(TRAD_TO_SIMP)) {
    result = result.replace(new RegExp(trad, 'g'), simp);
  }
  return result;
}

interface Poem {
  author: string;
  paragraphs: string[];
  title: string;
  id?: string;
}

interface Author {
  id: string;
  name: string;
  name_traditional: string;
  dynasty: string;
  bio?: string;
}

function poemToSQL(poem: Poem, authorId: string | null): string {
  const id = poem.id || generateUUID();
  const title = escapeSQL(poem.title);
  const titleSimplified = escapeSQL(toSimplified(poem.title));
  const paragraphs = poem.paragraphs || [];
  const content = JSON.stringify(paragraphs);
  const contentSimplified = JSON.stringify(paragraphs.map(toSimplified));
  const dynasty = '唐';
  const searchContent = escapeSQL(`${poem.title} ${poem.author} shi`);

  return `('${id}', '${title}', '${titleSimplified}', ${authorId ? `'${authorId}'` : 'NULL'}, '${dynasty}', '${escapeSQL(content)}', '${escapeSQL(contentSimplified)}', '诗', 'shi', '', NULL, '${searchContent}')`;
}

function authorToSQL(author: Author): string {
  const id = author.id || generateUUID();
  const name = escapeSQL(author.name);
  const nameTraditional = escapeSQL(author.name_traditional || author.name);
  const dynasty = '唐';
  const bio = escapeSQL(author.bio || '');

  return `('${id}', '${name}', '${nameTraditional}', '${dynasty}', '${bio}')`;
}

async function processAuthors(): Promise<Map<string, string>> {
  console.log('Processing authors...');
  const authorsFile = path.join(DATA_DIR, '全唐诗', 'authors.tang.json');
  const authorsOutput = path.join(OUTPUT_DIR, 'tang_authors.sql');

  if (!fs.existsSync(authorsFile)) {
    console.log('  Authors file not found');
    return new Map();
  }

  const content = fs.readFileSync(authorsFile, 'utf-8');
  const authors: Author[] = JSON.parse(content);

  const authorMap = new Map<string, string>();
  const sqlLines = ['-- Tang Dynasty Authors Import'];
  sqlLines.push('BEGIN;');
  sqlLines.push('');

  for (const author of authors) {
    const id = author.id || generateUUID();
    authorMap.set(author.name, id);
    sqlLines.push(`INSERT INTO authors (id, name, name_traditional, dynasty, bio) VALUES ${authorToSQL(author)};`);
  }

  sqlLines.push('');
  sqlLines.push('COMMIT;');
  sqlLines.push('');

  fs.writeFileSync(authorsOutput, sqlLines.join('\n'));
  console.log(`  Generated ${authorsOutput} with ${authors.length} authors`);

  return authorMap;
}

async function processPoems(authorMap: Map<string, string>): Promise<number> {
  console.log('Processing poems...');
  const poemsDir = path.join(DATA_DIR, '全唐诗');
  const poetFiles = fs.readdirSync(poemsDir)
    .filter(f => f.startsWith('poet.tang.') && f.endsWith('.json'))
    .sort();

  let totalPoems = 0;
  const BATCH_SIZE = 500;
  let batchNum = 0;

  for (const file of poetFiles) {
    const content = fs.readFileSync(path.join(poemsDir, file), 'utf-8');
    const poems: Poem[] = JSON.parse(content);
    totalPoems += poems.length;
  }

  console.log(`  Total poems to process: ${totalPoems}`);

  const sqlHeader = ['-- Tang Dynasty Poems Import'];
  sqlHeader.push('BEGIN;');
  sqlHeader.push('');

  let sqlContent = [...sqlHeader];
  let poemCount = 0;

  for (const file of poetFiles) {
    const content = fs.readFileSync(path.join(poemsDir, file), 'utf-8');
    const poems: Poem[] = JSON.parse(content);

    for (const poem of poems) {
      const authorId = authorMap.get(poem.author) || null;
      sqlContent.push(`INSERT INTO poems (id, title, title_simplified, author_id, dynasty, content, content_simplified, form_type, poem_type, rhythmic, tags, search_content) VALUES ${poemToSQL(poem, authorId)};`);
      poemCount++;

      if (poemCount % BATCH_SIZE === 0) {
        sqlContent.push('');
        sqlContent.push('COMMIT;');

        // Write this batch
        const outputFile = path.join(OUTPUT_DIR, `tang_poems_${String(batchNum).padStart(3, '0')}.sql`);
        fs.writeFileSync(outputFile, sqlContent.join('\n'));
        console.log(`  Written ${outputFile} (${poemCount} poems)`);

        // Start next batch
        batchNum++;
        sqlContent = [...sqlHeader];
      }
    }
  }

  // Write remaining
  if (poemCount % BATCH_SIZE !== 0) {
    sqlContent.push('');
    sqlContent.push('COMMIT;');
    const outputFile = path.join(OUTPUT_DIR, `tang_poems_${String(batchNum).padStart(3, '0')}.sql`);
    fs.writeFileSync(outputFile, sqlContent.join('\n'));
    console.log(`  Written ${outputFile} (${poemCount} total poems)`);
  }

  return totalPoems;
}

async function main() {
  console.log('Tang Poetry SQL Generator');
  console.log('========================\n');

  const startTime = Date.now();

  const authorMap = await processAuthors();
  const poemCount = await processPoems(authorMap);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nComplete! Generated SQL for ${poemCount} poems in ${elapsed}s`);
  console.log(`Output files: ${OUTPUT_DIR}/tang_*.sql`);
  console.log('\nTo import:');
  console.log('  npx wrangler d1 execute poetry-garden --remote --file=tang_authors.sql');
  console.log('  npx wrangler d1 execute poetry-garden --remote --file=tang_poems_000.sql');
  console.log('  ...');
}

main().catch(console.error);
