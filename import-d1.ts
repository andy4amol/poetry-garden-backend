/**
 * D1 Data Import Script
 *
 * Usage:
 * 1. Ensure D1 database is created and schema is applied
 * 2. Run: npx wrangler d1 execute poetry-garden --remote --file=./schema.sql
 * 3. Run: npx tsx import-d1.ts
 */

import { readFileSync } from 'fs';

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
  content: string;
  content_simplified: string | null;
  form_type: string | null;
  poem_type: string;
  rhythmic: string | null;
  tags: string | null;
  source_file: string | null;
  source_id: string | null;
  search_vector?: string;
  created_at?: string;
}

// Load data
const authors: Author[] = JSON.parse(readFileSync('./authors.json', 'utf-8'));
const poems: Poem[] = JSON.parse(readFileSync('./poems.json', 'utf-8'));

console.log(`Loaded ${authors.length} authors and ${poems.length} poems`);

// Generate search content for poems
function generateSearchContent(poem: Poem): string {
  const content = typeof poem.content === 'string' ? JSON.parse(poem.content) : poem.content;
  return Array.isArray(content) ? content.join(' ') : '';
}

// SQL templates
const INSERT_AUTHOR = `INSERT INTO authors (id, name, name_traditional, dynasty, bio) VALUES (?, ?, ?, ?, ?)`;
const INSERT_POEM = `INSERT INTO poems (id, title, title_simplified, author_id, dynasty, content, content_simplified, form_type, poem_type, rhythmic, tags, source_file, source_id, search_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function importAuthors(d1: D1Database): Promise<void> {
  console.log('Importing authors...');
  let imported = 0;

  for (const author of authors) {
    try {
      await d1.prepare(INSERT_AUTHOR)
        .bind(
          author.id,
          author.name,
          author.name_traditional || author.name,
          author.dynasty,
          author.bio || null
        )
        .run();
      imported++;
    } catch (e) {
      // Skip duplicates
    }
  }
  console.log(`Imported ${imported} authors`);
}

async function importPoems(d1: D1Database): Promise<void> {
  console.log('Importing poems...');
  let imported = 0;
  let batch: D1PreparedStatement[] = [];
  const BATCH_SIZE = 50;

  for (const poem of poems) {
    const searchContent = generateSearchContent(poem);

    const stmt = d1.prepare(INSERT_POEM)
      .bind(
        poem.id,
        poem.title,
        poem.title_simplified || poem.title,
        poem.author_id || null,
        poem.dynasty,
        typeof poem.content === 'string' ? poem.content : JSON.stringify(poem.content),
        poem.content_simplified || null,
        poem.form_type || null,
        poem.poem_type,
        poem.rhythmic || null,
        poem.tags || null,
        poem.source_file || null,
        poem.source_id || null,
        searchContent
      );

    batch.push(stmt);

    if (batch.length >= BATCH_SIZE) {
      // Execute batch
      await Promise.all(batch.map(stmt => stmt.run()));
      imported += batch.length;
      console.log(`Imported ${imported}/${poems.length} poems...`);
      batch = [];
    }
  }

  // Final batch
  if (batch.length > 0) {
    await Promise.all(batch.map(stmt => stmt.run()));
    imported += batch.length;
  }

  console.log(`Imported ${imported} poems`);
}

// Main import function
export async function runImport(d1: D1Database): Promise<void> {
  console.log('Starting D1 import...');
  console.log(`Database: ${d1}');

  await importAuthors(d1);
  await importPoems(d1);

  console.log('Import complete!');
}
