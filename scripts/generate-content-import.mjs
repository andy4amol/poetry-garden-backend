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
const r2Dir = path.join(outDir, "r2");
const r2Bucket = args.r2Bucket || "poetry-garden-content";
const limit = args.limit ? Number(args.limit) : Infinity;
const catalogPageSize = args.catalogPageSize ? Number(args.catalogPageSize) : 1000;

const collections = new Map();
const authors = new Map();
const works = [];
const nodes = [];
const paragraphs = [];
const strains = [];
const searchIndexRows = [];
const r2Objects = [];
const workContentByShard = new Map();
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

function json(value) {
  return JSON.stringify(value ?? null);
}

function preview(lines, maxLength = 80) {
  return lines.join("").slice(0, maxLength);
}

function writeR2Json(key, value) {
  const filePath = path.join(r2Dir, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
  r2Objects.push({ key, file: path.relative(outDir, filePath), bytes: fs.statSync(filePath).size });
}

function addWorkContent(workId, value) {
  const shard = workId.slice(0, 2);
  if (!workContentByShard.has(shard)) workContentByShard.set(shard, {});
  workContentByShard.get(shard)[workId] = value;
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
  const r2Key = `works-shards/${workId.slice(0, 2)}.json`;
  const tags = input.tags ? (Array.isArray(input.tags) ? input.tags : [input.tags]) : [];
  const metadata = input.metadata || {};
  const notes = input.notes || null;

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
    r2Key,
    previewTraditional: preview(traditionalLines),
    previewSimplified: preview(simplifiedLines),
    tags: tags.length ? json(tags) : null,
    metadata: json(metadata),
    popularityScore: input.popularityScore || 0,
    wordCount: plainSimplified.replace(/\s/g, "").length,
    lineCount: traditionalLines.length,
  });

  addWorkContent(workId, {
    id: workId,
    title_traditional: title,
    title_simplified: s(title),
    author_id: authorId,
    author_name_traditional: input.author || "",
    author_name_simplified: s(input.author || ""),
    dynasty: input.dynasty || null,
    genre: input.genre,
    form_type: input.formType || null,
    rhythmic: input.rhythmic || null,
    collection_id: input.collectionId || null,
    content_traditional: traditionalLines,
    content_simplified: simplifiedLines,
    plain_text_traditional: plainTraditional,
    plain_text_simplified: plainSimplified,
    notes,
    translation: input.translation || null,
    annotation: input.annotation || input.prologue || null,
    tags,
    metadata,
    source_path: input.sourcePath || null,
    source_id: input.sourceId || input.id || null,
    source_ref: input.sourceRef || null,
  });

  if (authorId) authors.get(authorId).workCount++;
  if (input.collectionId && collections.has(input.collectionId)) collections.get(input.collectionId).itemCount++;

  searchIndexRows.push({
    workId,
    titleTraditional: title,
    titleSimplified: s(title),
    authorNameTraditional: input.author || "",
    authorNameSimplified: s(input.author || ""),
    dynasty: input.dynasty || "",
    genre: input.genre,
    collectionId: input.collectionId || null,
    keywordText: [title, s(title), input.author || "", s(input.author || ""), input.dynasty || "", input.genre, input.collectionTitle || "", ...tags].filter(Boolean).join(" "),
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
    r2Key: null,
    previewTraditional: "",
    previewSimplified: "",
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
    previewTraditional: value.slice(0, 80),
    previewSimplified: s(value).slice(0, 80),
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

function writeNodeContentObjects() {
  for (const node of nodes) {
    const lines = nodeParagraphs.get(node.id) || [];
    if (!lines.length) continue;

    const collection = collections.get(node.collectionId);
    const simplifiedLines = lines.map(s);
    node.r2Key = `nodes/${node.id}.json`;
    node.previewTraditional = preview(lines);
    node.previewSimplified = preview(simplifiedLines);

    writeR2Json(node.r2Key, {
      id: node.id,
      collection_id: node.collectionId,
      collection_slug: collection?.slug || null,
      title_traditional: node.titleTraditional,
      title_simplified: node.titleSimplified,
      author_name_traditional: node.authorNameTraditional || "",
      author_name_simplified: node.authorNameSimplified || "",
      paragraphs: lines.map((line, index) => ({
        id: idFor("paragraph", node.id, String(index)),
        order_index: index,
        text_traditional: line,
        text_simplified: simplifiedLines[index],
      })),
    });
  }
}

function workSummary(work) {
  const collection = work.collectionId ? collections.get(work.collectionId) : null;
  return {
    id: work.id,
    title_traditional: work.titleTraditional,
    title_simplified: work.titleSimplified,
    author_id: work.authorId,
    author_name_traditional: work.authorNameTraditional,
    author_name_simplified: work.authorNameSimplified,
    dynasty: work.dynasty,
    genre: work.genre,
    form_type: work.formType,
    rhythmic: work.rhythmic,
    collection_id: work.collectionId,
    collection_slug: collection?.slug || null,
    collection_title_traditional: collection?.titleTraditional || null,
    collection_title_simplified: collection?.titleSimplified || null,
    r2_key: work.r2Key,
    preview_traditional: work.previewTraditional,
    preview_simplified: work.previewSimplified,
    content_traditional: [work.previewTraditional],
    content_simplified: [work.previewSimplified],
    tags: work.tags ? JSON.parse(work.tags) : [],
    popularity_score: work.popularityScore,
    word_count: work.wordCount,
    line_count: work.lineCount,
  };
}

function writePagedCatalog(prefix, rows) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / catalogPageSize));
  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * catalogPageSize;
    writeR2Json(`${prefix}/page-${String(page).padStart(5, "0")}.json`, {
      items: rows.slice(start, start + catalogPageSize),
      total,
      page,
      page_size: catalogPageSize,
      total_pages: totalPages,
    });
  }
}

function safeSegment(value) {
  return encodeURIComponent(String(value || "_")).replace(/%/g, "~");
}

function searchBucketFor(value) {
  const char = [...String(value || "")][0];
  if (!char) return null;
  return (char.codePointAt(0) % 256).toString(16).padStart(2, "0");
}

function addToBucket(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function dynastyLabel(name) {
  if (String(name).endsWith("代")) return name;
  if (["唐", "宋", "元", "明", "清"].includes(String(name))) return `${name}代`;
  return String(name);
}

function writeCatalogIndexes() {
  for (const [shard, values] of workContentByShard) {
    writeR2Json(`works-shards/${shard}.json`, values);
  }

  const sortedWorks = works.map(workSummary).sort((a, b) => (b.popularity_score || 0) - (a.popularity_score || 0));
  writePagedCatalog("catalog/works/all", sortedWorks);

  const buckets = new Map();
  const authorBuckets = new Map();
  const searchBuckets = new Map();

  for (const summary of sortedWorks) {
    addToBucket(buckets, `genre/${safeSegment(summary.genre)}`, summary);
    addToBucket(buckets, `dynasty/${safeSegment(summary.dynasty)}`, summary);
    addToBucket(authorBuckets, summary.author_id, summary);
    addToBucket(buckets, `collection/${safeSegment(summary.collection_id)}`, summary);
    if (summary.genre && summary.dynasty) addToBucket(buckets, `genre/${safeSegment(summary.genre)}/dynasty/${safeSegment(summary.dynasty)}`, summary);

    const searchText = [
      summary.title_traditional,
      summary.title_simplified,
      summary.author_name_traditional,
      summary.author_name_simplified,
      summary.dynasty,
      summary.genre,
    ].filter(Boolean).join(" ");
    const chars = new Set([
      [...String(summary.title_traditional || '')][0],
      [...String(summary.title_simplified || '')][0],
      [...String(summary.author_name_traditional || '')][0],
      [...String(summary.author_name_simplified || '')][0],
    ].filter(Boolean));
    for (const char of chars) {
      const key = searchBucketFor(char);
      addToBucket(searchBuckets, key, { ...summary, search_text: searchText });
    }
  }

  for (const [key, rows] of buckets) {
    writePagedCatalog(`catalog/works/${key}`, rows);
  }

  const authorShards = new Map();
  for (const [authorId, rows] of authorBuckets) {
    if (!authorId) continue;
    const shard = String(authorId).slice(0, 2);
    if (!authorShards.has(shard)) authorShards.set(shard, {});
    authorShards.get(shard)[authorId] = rows;
  }
  for (const [shard, authorMap] of authorShards) {
    writeR2Json(`catalog/works/author-shards/${shard}.json`, authorMap);
  }

  for (const [key, rows] of searchBuckets) {
    writeR2Json(`catalog/search-buckets/${key}.json`, rows);
  }

  const authorRows = [...authors.values()].map((author) => ({
    id: author.id,
    name: author.nameTraditional,
    name_traditional: author.nameTraditional,
    name_simplified: author.nameSimplified,
    dynasty: author.dynasty,
    description: author.descriptionTraditional,
    description_traditional: author.descriptionTraditional,
    description_simplified: author.descriptionSimplified,
    work_count: author.workCount,
  })).sort((a, b) => `${a.dynasty || ""}${a.name_simplified}`.localeCompare(`${b.dynasty || ""}${b.name_simplified}`));
  writeR2Json("catalog/authors/all.json", authorRows);

  const dynastyNames = [...new Set([
    ...works.map((work) => work.dynasty),
    ...authors.values().map((author) => author.dynasty),
    ...collections.values().map((collection) => collection.dynasty),
  ].filter(Boolean))];
  const dynastyOrder = ["先秦", "秦", "汉", "魏晋", "南北朝", "隋", "唐", "五代", "宋", "辽", "金", "元", "明", "清", "近现代"];
  const dynastyRows = dynastyNames
    .sort((a, b) => {
      const ai = dynastyOrder.indexOf(a);
      const bi = dynastyOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return String(a).localeCompare(String(b));
    })
    .map((name, index) => ({ id: index + 1, name, name_zh: dynastyLabel(name) }));
  writeR2Json("catalog/dynasties/all.json", dynastyRows);

  const collectionRows = [...collections.values()]
    .map((collection) => ({
      id: collection.id,
      slug: collection.slug,
      title_traditional: collection.titleTraditional,
      title_simplified: collection.titleSimplified,
      type: collection.type,
      dynasty: collection.dynasty,
      description_traditional: collection.descriptionTraditional,
      description_simplified: collection.descriptionSimplified,
      source_path: collection.sourcePath,
      sort_order: collection.sortOrder,
      item_count: collection.itemCount,
    }))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.title_simplified.localeCompare(b.title_simplified));
  writeR2Json("catalog/collections/all.json", collectionRows);

  const nodesByCollection = new Map();
  const childrenByParent = new Map();
  for (const node of nodes) {
    const summary = {
      id: node.id,
      collection_id: node.collectionId,
      parent_id: node.parentId,
      node_type: node.nodeType,
      title_traditional: node.titleTraditional,
      title_simplified: node.titleSimplified,
      author_id: node.authorId,
      author_name_traditional: node.authorNameTraditional,
      author_name_simplified: node.authorNameSimplified,
      source_path: node.sourcePath,
      source_ref: node.sourceRef,
      r2_key: node.r2Key,
      preview_traditional: node.previewTraditional,
      preview_simplified: node.previewSimplified,
      order_index: node.orderIndex,
      paragraph_count: node.paragraphCount,
      metadata: node.metadata ? JSON.parse(node.metadata) : {},
    };
    addToBucket(nodesByCollection, node.collectionId, summary);
    if (node.parentId) addToBucket(childrenByParent, node.parentId, summary);
  }

  for (const collection of collections.values()) {
    const collectionNodes = (nodesByCollection.get(collection.id) || []).sort((a, b) => {
      const parentCompare = String(a.parent_id || "").localeCompare(String(b.parent_id || ""));
      return parentCompare || a.order_index - b.order_index;
    });
    const rootNodes = collectionNodes.filter((node) => !node.parent_id).sort((a, b) => a.order_index - b.order_index);
    writeR2Json(`catalog/collections/${collection.id}.json`, { collection: collectionRows.find((item) => item.id === collection.id), root_nodes: rootNodes });
    writeR2Json(`catalog/collections/${collection.slug}.json`, { collection: collectionRows.find((item) => item.id === collection.id), root_nodes: rootNodes });
    writeR2Json(`catalog/collections/${collection.id}/tree.json`, { collection: collectionRows.find((item) => item.id === collection.id), nodes: collectionNodes });
    writeR2Json(`catalog/collections/${collection.slug}/tree.json`, { collection: collectionRows.find((item) => item.id === collection.id), nodes: collectionNodes });
  }

  for (const node of nodes) {
    if (!node.r2Key) continue;
    const nodeJsonPath = `nodes/${node.id}.json`;
    const nodePath = path.join(r2Dir, nodeJsonPath);
    const nodeObject = JSON.parse(fs.readFileSync(nodePath, "utf8"));
    nodeObject.children = (childrenByParent.get(node.id) || []).sort((a, b) => a.order_index - b.order_index);
    fs.writeFileSync(nodePath, `${JSON.stringify(nodeObject)}\n`);
    const manifestItem = r2Objects.find((item) => item.key === node.r2Key);
    if (manifestItem) manifestItem.bytes = fs.statSync(nodePath).size;
  }

  writeR2Json("catalog/random/work-ids.json", sortedWorks.map((work) => work.id));
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
      search_index_rows: searchIndexRows.length,
      r2_objects: r2Objects.length,
      r2_bytes: r2Objects.reduce((sum, item) => sum + item.bytes, 0),
    },
    r2_bucket: r2Bucket,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, "r2-manifest.json"), JSON.stringify(r2Objects, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

function pruneUnusedAuthorsForLimitedImport() {
  if (!Number.isFinite(limit)) return;
  const usedAuthorIds = new Set();
  for (const work of works) {
    if (work.authorId) usedAuthorIds.add(work.authorId);
  }
  for (const node of nodes) {
    if (node.authorId) usedAuthorIds.add(node.authorId);
  }

  for (const id of authors.keys()) {
    if (!usedAuthorIds.has(id)) authors.delete(id);
  }
}

function writeR2UploadScript() {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `BUCKET="\${1:-${r2Bucket}}"`,
    'CONCURRENCY="${UPLOAD_CONCURRENCY:-8}"',
    "export BUCKET",
    'BASE_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'MANIFEST="$BASE_DIR/r2-manifest.json"',
    'LOG="${UPLOAD_LOG:-$BASE_DIR/upload-r2.log}"',
    "",
    'if ! command -v jq >/dev/null 2>&1; then',
    '  echo "jq is required to read $MANIFEST. Install jq or run: brew install jq" >&2',
    "  exit 1",
    "fi",
    "",
    ': > "$LOG"',
    'echo "Uploading $(jq length "$MANIFEST") R2 objects to $BUCKET with concurrency=$CONCURRENCY"',
    "export BASE_DIR LOG",
    'jq -r \'.[] | [.key, .file] | @tsv\' "$MANIFEST" | xargs -n 2 -P "$CONCURRENCY" bash -c \'',
    '  set -euo pipefail',
    '  key="$1"',
    '  file="$2"',
    '  npx wrangler r2 object put "$BUCKET/$key" --remote --file="$BASE_DIR/$file" --content-type="application/json" >>"$LOG" 2>&1',
    '\' _',
    'echo "R2 upload complete."',
    "",
  ];

  const scriptPath = path.join(outDir, "upload-r2.sh");
  fs.writeFileSync(scriptPath, `${lines.join("\n")}\n`);
  fs.chmodSync(scriptPath, 0o755);
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
  fs.mkdirSync(r2Dir, { recursive: true });

  importAuthors();
  importPoetryLike();
  importBooks();
  writeNodeContentObjects();
  importStrains();
  pruneUnusedAuthorsForLimitedImport();
  recalculateCollectionCounts();
  writeCatalogIndexes();

  fs.copyFileSync(path.join(repoRoot, "migrations", "0001_content_platform.sql"), path.join(outDir, "0000_schema.sql"));
  fs.writeFileSync(path.join(outDir, "0001_clear.sql"), [
    "-- Static catalog data lives in R2. D1 only stores dynamic user state.",
    "",
  ].join("\n"));
  writeR2UploadScript();
  writeManifest();
}

main();
