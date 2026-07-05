#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Converter as createT2S } from "opencc-js/t2cn";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const defaultDataDir = path.resolve(repoRoot, "..", "chinese-poetry");
const t2s = createT2S({ from: "tw", to: "cn" });

const args = parseArgs(process.argv.slice(2));
const dataDir = path.resolve(args.data || defaultDataDir);
const outDir = path.resolve(args.out || path.join(repoRoot, "imports", "content"));
const limit = args.limit ? Number(args.limit) : Infinity;
const batchSize = args.batchSize ? Number(args.batchSize) : 400;

const collections = new Map();
const authors = new Map();
const works = [];
const nodes = [];
const paragraphs = [];
const strains = [];
const searchRows = [];
const nodeById = new Map();
const nodeParagraphs = new Map();

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        result[key] = true;
      } else {
        result[key] = next;
        i++;
      }
    }
  }
  return result;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), "utf8"));
}

function exists(rel) {
  return fs.existsSync(path.join(dataDir, rel));
}

function list(dir, predicate) {
  const full = path.join(dataDir, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter(predicate).sort().map((file) => path.join(dir, file));
}

function idFor(...parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("\u0000")).digest("hex").slice(0, 32);
}

function s(text) {
  return t2s(String(text || ""));
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function linesFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((line) => String(line));
  if (typeof value === "string") return value.split(/\r?\n/).filter(Boolean);
  return [];
}

function addCollection({ slug, title, type, dynasty = null, description = "", sourcePath = "", sortOrder = 0 }) {
  const id = idFor("collection", slug);
  if (!collections.has(id)) {
    collections.set(id, {
      id,
      slug,
      titleTraditional: title,
      titleSimplified: s(title),
      type,
      dynasty,
      descriptionTraditional: description,
      descriptionSimplified: s(description),
      sourcePath,
      sortOrder,
      itemCount: 0,
    });
  }
  return id;
}

function addAuthor(name, dynasty, description = "", source = "", sourceId = "") {
  if (!name) return null;
  const id = idFor("author", dynasty || "", name);
  if (!authors.has(id)) {
    authors.set(id, {
      id,
      nameTraditional: name,
      nameSimplified: s(name),
      dynasty,
      descriptionTraditional: description,
      descriptionSimplified: s(description),
      source,
      sourceId,
      workCount: 0,
    });
  } else if (description && !authors.get(id).descriptionTraditional) {
    authors.get(id).descriptionTraditional = description;
    authors.get(id).descriptionSimplified = s(description);
  }
  return id;
}

function addWork(input) {
  if (works.length >= limit) return null;
  const traditionalLines = linesFrom(input.paragraphs || input.content || input.para);
  if (!traditionalLines.length) return null;

  const authorId = addAuthor(input.author || "", input.dynasty || "", input.authorDescription || "", input.source || "", input.authorSourceId || "");
  const title = input.title || input.rhythmic || "未题";
  const workId = input.id || idFor("work", input.sourcePath, input.sourceRef || "", input.dynasty || "", input.author || "", title, traditionalLines.join("\n"));
  const simplifiedLines = traditionalLines.map(s);
  const plainTraditional = traditionalLines.join("\n");
  const plainSimplified = simplifiedLines.join("\n");

  works.push({
    id: workId,
    titleTraditional: title,
    titleSimplified: s(title),
    authorId,
    authorNameTraditional: input.author || "",
    authorNameSimplified: s(input.author || ""),
    dynasty: input.dynasty || null,
    genre: input.genre,
    formType: input.formType || null,
    rhythmic: input.rhythmic || null,
    collectionId: input.collectionId || null,
    sourcePath: input.sourcePath || null,
    sourceId: input.sourceId || input.id || null,
    sourceRef: input.sourceRef || null,
    contentTraditional: json(traditionalLines),
    contentSimplified: json(simplifiedLines),
    plainTextTraditional: plainTraditional,
    plainTextSimplified: plainSimplified,
    notes: input.notes ? json(input.notes) : null,
    translation: input.translation || null,
    annotation: input.annotation || input.prologue || null,
    tags: input.tags ? json(Array.isArray(input.tags) ? input.tags : [input.tags]) : null,
    metadata: json(input.metadata || {}),
    popularityScore: input.popularityScore || 0,
    wordCount: plainSimplified.replace(/\s/g, "").length,
    lineCount: traditionalLines.length,
  });

  if (authorId) authors.get(authorId).workCount++;
  if (input.collectionId && collections.has(input.collectionId)) collections.get(input.collectionId).itemCount++;

  searchRows.push({
    entityType: "work",
    entityId: workId,
    title: `${title} ${s(title)}`,
    author: `${input.author || ""} ${s(input.author || "")}`,
    body: `${plainTraditional}\n${plainSimplified}`,
    dynasty: input.dynasty || "",
    genre: input.genre,
    collection: input.collectionTitle || "",
  });

  return workId;
}

function addNode({ collectionId, parentId = null, nodeType, title, author = "", sourcePath = "", sourceRef = "", orderIndex = 0, metadata = {} }) {
  const id = idFor("node", collectionId, parentId || "", sourcePath, sourceRef, title, String(orderIndex));
  const node = {
    id,
    collectionId,
    parentId,
    nodeType,
    titleTraditional: title,
    titleSimplified: s(title),
    authorId: author ? addAuthor(author, "", "", "book", "") : null,
    authorNameTraditional: author,
    authorNameSimplified: s(author),
    sourcePath,
    sourceRef,
    orderIndex,
    paragraphCount: 0,
    metadata: json(metadata),
  };
  nodes.push(node);
  nodeById.set(id, node);
  return id;
}

function addNodeParagraph(nodeId, text, orderIndex, metadata = {}) {
  const value = String(text || "").trim();
  if (!value) return;
  paragraphs.push({
    id: idFor("paragraph", nodeId, String(orderIndex)),
    workId: null,
    nodeId,
    orderIndex,
    textTraditional: value,
    textSimplified: s(value),
    annotation: null,
    translation: null,
    notes: null,
    metadata: json(metadata),
  });
  if (!nodeParagraphs.has(nodeId)) nodeParagraphs.set(nodeId, []);
  nodeParagraphs.get(nodeId).push(value);
  const node = nodeById.get(nodeId);
  if (node) node.paragraphCount++;
}

function importAuthors() {
  const tang = exists("全唐诗/authors.tang.json") ? readJson("全唐诗/authors.tang.json") : [];
  for (const item of tang) addAuthor(item.name, "唐", item.desc || "", "全唐诗/authors.tang.json", item.id);

  const song = exists("全唐诗/authors.song.json") ? readJson("全唐诗/authors.song.json") : [];
  for (const item of song) addAuthor(item.name, "宋", item.desc || "", "全唐诗/authors.song.json", item.id);

  const ci = exists("宋词/author.song.json") ? readJson("宋词/author.song.json") : [];
  for (const item of ci) addAuthor(item.name, "宋", item.description || item.short_description || "", "宋词/author.song.json", item.name);
}

function importPoetryLike() {
  const specs = [
    {
      files: list("全唐诗", (f) => /^poet\.tang\.\d+\.json$/.test(f)),
      collection: { slug: "quantangshi", title: "全唐诗", type: "poetry", dynasty: "唐", sortOrder: 10 },
      dynasty: "唐",
      genre: "shi",
      formType: "诗",
    },
    {
      files: list("全唐诗", (f) => /^poet\.song\.\d+\.json$/.test(f)),
      collection: { slug: "quansongshi", title: "全宋诗", type: "poetry", dynasty: "宋", sortOrder: 20 },
      dynasty: "宋",
      genre: "shi",
      formType: "诗",
    },
    {
      files: list("宋词", (f) => /^ci\.song\.\d+\.json$/.test(f)),
      collection: { slug: "quansongci", title: "全宋词", type: "ci", dynasty: "宋", sortOrder: 30 },
      dynasty: "宋",
      genre: "ci",
      formType: "词",
    },
  ];

  for (const spec of specs) {
    const collectionId = addCollection({ ...spec.collection, sourcePath: spec.files[0] || "" });
    for (const rel of spec.files) {
      for (const item of readJson(rel)) {
        if (works.length >= limit) return;
        addWork({
          ...item,
          dynasty: spec.dynasty,
          genre: spec.genre,
          formType: spec.formType,
          rhythmic: item.rhythmic || "",
          collectionId,
          collectionTitle: spec.collection.title,
          sourcePath: rel,
          source: rel,
        });
      }
    }
  }

  const singleSpecs = [
    ["元曲/yuanqu.json", "yuanqu", "元曲", "qu", "元", "曲"],
    ["诗经/shijing.json", "shijing", "诗经", "shijing", "先秦", "诗经"],
    ["楚辞/chuci.json", "chuci", "楚辞", "chuci", "战国", "楚辞"],
    ["曹操诗集/caocao.json", "caocao", "曹操诗集", "shi", "魏", "诗"],
    ["纳兰性德/纳兰性德诗集.json", "nalanxingde", "纳兰性德诗集", "ci", "清", "词"],
    ["水墨唐诗/shuimotangshi.json", "shuimotangshi", "水墨唐诗", "shi", "唐", "诗"],
    ["五代诗词/nantang/poetrys.json", "nantang", "南唐二主词", "ci", "五代", "词"],
  ];

  for (const [rel, slug, title, genre, dynasty, formType] of singleSpecs) {
    if (!exists(rel) || works.length >= limit) continue;
    const collectionId = addCollection({ slug, title, type: genre, dynasty, sourcePath: rel, sortOrder: 100 });
    for (const item of readJson(rel)) {
      if (works.length >= limit) return;
      addWork({
        ...item,
        paragraphs: item.paragraphs || item.content || item.para,
        title: item.title || item.chapter,
        dynasty: item.dynasty === "yuan" ? "元" : dynasty,
        genre,
        formType,
        rhythmic: item.rhythmic || null,
        collectionId,
        collectionTitle: title,
        sourcePath: rel,
        prologue: item.prologue || null,
        notes: item.notes || null,
      });
    }
  }
}

function importBooks() {
  const simpleBooks = [
    ["论语/lunyu.json", "lunyu", "论语", "classics", "儒家经典"],
    ["四书五经/mengzi.json", "mengzi", "孟子", "classics", "四书"],
  ];

  for (const [rel, slug, title, type, description] of simpleBooks) {
    if (!exists(rel)) continue;
    const collectionId = addCollection({ slug, title, type, description, sourcePath: rel, sortOrder: 200 });
    readJson(rel).forEach((chapter, chapterIndex) => {
      const nodeId = addNode({
        collectionId,
        nodeType: "chapter",
        title: chapter.chapter,
        sourcePath: rel,
        sourceRef: chapter.chapter,
        orderIndex: chapterIndex,
      });
      linesFrom(chapter.paragraphs).forEach((line, index) => addNodeParagraph(nodeId, line, index));
    });
  }

  const objectBooks = [
    ["四书五经/daxue.json", "daxue", "大学", "classics", "四书"],
    ["四书五经/zhongyong.json", "zhongyong", "中庸", "classics", "四书"],
  ];

  for (const [rel, slug, title, type, description] of objectBooks) {
    if (!exists(rel)) continue;
    const data = readJson(rel);
    const collectionId = addCollection({ slug, title, type, description, sourcePath: rel, sortOrder: 201 });
    const nodeId = addNode({
      collectionId,
      nodeType: "book",
      title: data.chapter || title,
      sourcePath: rel,
      orderIndex: 0,
    });
    linesFrom(data.paragraphs).forEach((line, index) => addNodeParagraph(nodeId, line, index));
  }

  if (exists("幽梦影/youmengying.json")) {
    const rel = "幽梦影/youmengying.json";
    const collectionId = addCollection({ slug: "youmengying", title: "幽梦影", type: "essay", sourcePath: rel, sortOrder: 230 });
    readJson(rel).forEach((entry, index) => {
      const nodeId = addNode({ collectionId, nodeType: "entry", title: `第 ${index + 1} 则`, sourcePath: rel, orderIndex: index });
      addNodeParagraph(nodeId, entry.content, 0, { comment: entry.comment || [] });
    });
  }

  for (const rel of list("蒙学", (file) => file.endsWith(".json"))) {
    const data = readJson(rel);
    const title = data.title || path.basename(rel, ".json");
    const slug = `mengxue-${path.basename(rel, ".json").replace(/[^a-zA-Z0-9_-]/g, "") || idFor(rel).slice(0, 8)}`;
    const collectionId = addCollection({
      slug,
      title,
      type: "primer",
      description: Array.isArray(data.abstract) ? data.abstract.join("\n") : data.abstract || "",
      sourcePath: rel,
      sortOrder: 240,
    });

    if (data.paragraphs) {
      const nodeId = addNode({ collectionId, nodeType: "book", title, author: data.author || "", sourcePath: rel, orderIndex: 0, metadata: { tags: data.tags || null } });
      linesFrom(data.paragraphs).forEach((line, index) => addNodeParagraph(nodeId, line, index));
    }

    if (data.content) importNestedContent(collectionId, null, data.content, rel);
  }
}

function importNestedContent(collectionId, parentId, content, sourcePath, depth = 0) {
  if (!Array.isArray(content)) return;
  content.forEach((item, index) => {
    if (typeof item === "string") {
      if (parentId) addNodeParagraph(parentId, item, index);
      return;
    }
    if (!item || typeof item !== "object") return;
    const title = item.title || item.chapter || item.source || `第 ${index + 1} 节`;
    const nodeId = addNode({
      collectionId,
      parentId,
      nodeType: item.paragraphs ? "article" : depth === 0 ? "volume" : "section",
      title,
      author: item.author || "",
      sourcePath,
      sourceRef: title,
      orderIndex: index,
      metadata: { source: item.source || null },
    });
    linesFrom(item.paragraphs).forEach((line, paragraphIndex) => addNodeParagraph(nodeId, line, paragraphIndex));
    if (item.content) importNestedContent(collectionId, nodeId, item.content, sourcePath, depth + 1);
  });
}

function importStrains() {
  const importedWorkIds = new Set(works.map((work) => work.id));
  for (const rel of list("strains/json", (f) => /^poet\.tang\.\d+\.json$/.test(f))) {
    for (const item of readJson(rel)) {
      if (!item.id || !Array.isArray(item.strains)) continue;
      if (!importedWorkIds.has(item.id)) continue;
      item.strains.forEach((pattern, index) => {
        strains.push({ workId: item.id, lineIndex: index, pattern });
      });
    }
  }
}

function addBookSearchRows() {
  for (const node of nodes) {
    const lines = nodeParagraphs.get(node.id) || [];
    if (!lines.length) continue;

    const collection = collections.get(node.collectionId);
    lines.forEach((line, index) => {
      searchRows.push({
        entityType: "node",
        entityId: node.id,
        title: `${node.titleTraditional} ${node.titleSimplified}`,
        author: `${node.authorNameTraditional || ""} ${node.authorNameSimplified || ""}`,
        body: `${line}\n${s(line)}`,
        dynasty: collection?.dynasty || "",
        genre: collection?.type || "book",
        collection: collection?.titleSimplified || collection?.titleTraditional || "",
        orderIndex: index,
      });
    });
  }
}

function collectionInsert(item) {
  return `INSERT OR REPLACE INTO content_collections (id, slug, title_traditional, title_simplified, type, dynasty, description_traditional, description_simplified, source_path, sort_order, item_count) VALUES (${[
    item.id, item.slug, item.titleTraditional, item.titleSimplified, item.type, item.dynasty, item.descriptionTraditional, item.descriptionSimplified, item.sourcePath, item.sortOrder, item.itemCount,
  ].map(sql).join(", ")});`;
}

function authorInsert(item) {
  return `INSERT OR REPLACE INTO content_authors (id, name_traditional, name_simplified, dynasty, description_traditional, description_simplified, source, source_id, work_count) VALUES (${[
    item.id, item.nameTraditional, item.nameSimplified, item.dynasty, item.descriptionTraditional, item.descriptionSimplified, item.source, item.sourceId, item.workCount,
  ].map(sql).join(", ")});`;
}

function workInsert(item) {
  return `INSERT OR REPLACE INTO works (id, title_traditional, title_simplified, author_id, author_name_traditional, author_name_simplified, dynasty, genre, form_type, rhythmic, collection_id, source_path, source_id, source_ref, content_traditional, content_simplified, plain_text_traditional, plain_text_simplified, notes, translation, annotation, tags, metadata, popularity_score, word_count, line_count) VALUES (${[
    item.id, item.titleTraditional, item.titleSimplified, item.authorId, item.authorNameTraditional, item.authorNameSimplified, item.dynasty, item.genre, item.formType, item.rhythmic, item.collectionId, item.sourcePath, item.sourceId, item.sourceRef, item.contentTraditional, item.contentSimplified, item.plainTextTraditional, item.plainTextSimplified, item.notes, item.translation, item.annotation, item.tags, item.metadata, item.popularityScore, item.wordCount, item.lineCount,
  ].map(sql).join(", ")});`;
}

function nodeInsert(item) {
  return `INSERT OR REPLACE INTO book_nodes (id, collection_id, parent_id, node_type, title_traditional, title_simplified, author_id, author_name_traditional, author_name_simplified, source_path, source_ref, order_index, paragraph_count, metadata) VALUES (${[
    item.id, item.collectionId, item.parentId, item.nodeType, item.titleTraditional, item.titleSimplified, item.authorId, item.authorNameTraditional, item.authorNameSimplified, item.sourcePath, item.sourceRef, item.orderIndex, item.paragraphCount, item.metadata,
  ].map(sql).join(", ")});`;
}

function paragraphInsert(item) {
  return `INSERT OR REPLACE INTO paragraphs (id, work_id, node_id, order_index, text_traditional, text_simplified, annotation, translation, notes, metadata) VALUES (${[
    item.id, item.workId, item.nodeId, item.orderIndex, item.textTraditional, item.textSimplified, item.annotation, item.translation, item.notes, item.metadata,
  ].map(sql).join(", ")});`;
}

function strainInsert(item) {
  return `INSERT OR REPLACE INTO work_strains (work_id, line_index, pattern) VALUES (${[
    item.workId, item.lineIndex, item.pattern,
  ].map(sql).join(", ")});`;
}

function searchInsert(item) {
  return `INSERT INTO content_search (entity_type, entity_id, title, author, body, dynasty, genre, collection) VALUES (${[
    item.entityType, item.entityId, item.title, item.author, item.body, item.dynasty, item.genre, item.collection,
  ].map(sql).join(", ")});`;
}

function writeBatches(name, rows, mapper) {
  let fileIndex = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize);
    const output = [...chunk.map(mapper), ""].join("\n");
    fs.writeFileSync(path.join(outDir, `${name}_${String(fileIndex).padStart(4, "0")}.sql`), output);
    fileIndex++;
  }
}

function writeManifest() {
  const manifest = {
    generated_at: new Date().toISOString(),
    data_dir: dataDir,
    limit: Number.isFinite(limit) ? limit : null,
    counts: {
      collections: collections.size,
      authors: authors.size,
      works: works.length,
      book_nodes: nodes.length,
      paragraphs: paragraphs.length,
      strains: strains.length,
      search_rows: searchRows.length,
    },
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

function recalculateCollectionCounts() {
  const workCounts = new Map();
  for (const work of works) {
    if (!work.collectionId) continue;
    workCounts.set(work.collectionId, (workCounts.get(work.collectionId) || 0) + 1);
  }

  const nodeCounts = new Map();
  const paragraphCounts = new Map();
  for (const node of nodes) {
    nodeCounts.set(node.collectionId, (nodeCounts.get(node.collectionId) || 0) + 1);
    paragraphCounts.set(node.collectionId, (paragraphCounts.get(node.collectionId) || 0) + (node.paragraphCount || 0));
  }

  for (const collection of collections.values()) {
    const workCount = workCounts.get(collection.id) || 0;
    if (workCount > 0) {
      collection.itemCount = workCount;
      continue;
    }

    collection.itemCount = paragraphCounts.get(collection.id) || nodeCounts.get(collection.id) || 0;
  }
}

function main() {
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Data directory not found: ${dataDir}`);
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  importAuthors();
  importPoetryLike();
  importBooks();
  addBookSearchRows();
  importStrains();
  recalculateCollectionCounts();

  fs.copyFileSync(path.join(repoRoot, "migrations", "0001_content_platform.sql"), path.join(outDir, "0000_schema.sql"));
  fs.writeFileSync(path.join(outDir, "0001_clear.sql"), [
    "DELETE FROM content_search;",
    "DELETE FROM work_strains;",
    "DELETE FROM work_metadata;",
    "DELETE FROM paragraphs;",
    "DELETE FROM book_nodes;",
    "DELETE FROM works;",
    "DELETE FROM content_authors;",
    "DELETE FROM content_collections;",
    "",
  ].join("\n"));

  writeBatches("010_collections", [...collections.values()], collectionInsert);
  writeBatches("020_authors", [...authors.values()], authorInsert);
  writeBatches("030_works", works, workInsert);
  writeBatches("040_book_nodes", nodes, nodeInsert);
  writeBatches("050_paragraphs", paragraphs, paragraphInsert);
  writeBatches("060_strains", strains, strainInsert);
  writeBatches("070_search", searchRows, searchInsert);
  writeManifest();
}

main();
