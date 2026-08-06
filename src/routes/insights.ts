import { Hono } from "hono";
import { cachePublic, readR2Json } from "./helpers";

interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  // Secrets uploaded via `wrangler secret put MINIMAX_API_KEY` (or the
  // MINIMAX_API_KEY env var when running locally). The MINIMAX_BASE_URL
  // is configurable for local dev (e.g. a proxy) but defaults to the
  // public MiniMax endpoint.
  MINIMAX_API_KEY: string;
  MINIMAX_BASE_URL?: string;
  MINIMAX_MODEL?: string;
}

export const insights = new Hono<{ Bindings: Env }>();

interface WorkFull {
  id: string;
  title_traditional: string | null;
  title_simplified: string | null;
  author_name_traditional: string | null;
  author_name_simplified: string | null;
  dynasty: string | null;
  content_traditional: string[];
  content_simplified: string[] | null;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

interface ChatResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Llama 3.1 8B was deprecated by Cloudflare on 2026-05-30. The current
// default model is MiniMax M2.1 highspeed, an OpenAI-compatible chat
// model hosted at api.minimaxi.com. Cheap, fast, and good at short
// Chinese-language output.
const DEFAULT_MODEL = "MiniMax-M2.1-highspeed";
const DEFAULT_BASE_URL = "https://api.minimaxi.com/v1";

function buildPrompt(work: WorkFull): string {
  const lines = (work.content_traditional || []).slice(0, 8).join(" / ");
  const author = work.author_name_traditional || work.author_name_simplified || "佚名";
  const dynasty = work.dynasty || "";
  const title = work.title_traditional || work.title_simplified || "";
  // The prompt is intentionally minimal — small models drift on long
  // instructions and emit garbled structures, so we strip out any
  // formatting hint that could trigger table or markdown output.
  return [
    `${title} - ${author} (${dynasty})`,
    lines,
    "",
    "请先给三句白话译文,然后给一句话背景,最后给三个关键词。",
    "译文：",
    "背景：",
    "关键词：",
  ].join("\n");
}

interface ParsedInsight {
  translation: string;
  context: string;
  themes: string;
}

function parseInsightResponse(raw: string): ParsedInsight {
  // Tolerant parser: tries strict 译文/背景/主题 labels first, then falls
  // back to the simpler 译文:/背景:/关键词: prompts issued in
  // buildPrompt, and finally returns whole-text fallbacks so users
  // never see an empty insight for an OK AI response.
  const tryStrict = (re: RegExp) => (raw.match(re) || [])[1]?.trim() ?? "";

  const translation =
    tryStrict(/【译文】\s*([\s\S]*?)(?=\n\s*【背景】|$)/) ||
    tryStrict(/译文[:：]\s*([\s\S]*?)(?=\n\s*背景|$)/) ||
    raw.slice(0, 200);

  const context =
    tryStrict(/【背景】\s*([\s\S]*?)(?=\n\s*【主题】|$)/) ||
    tryStrict(/背景[:：]\s*([\s\S]*?)(?=\n\s*关键词|$)/) ||
    raw.slice(0, 200);

  const themes =
    tryStrict(/【主题】\s*([\s\S]*?)$/) ||
    tryStrict(/关键词[:：]\s*([\s\S]*?)$/) ||
    "古诗";
  return { translation, context, themes };
}

async function callMinimax(
  apiKey: string,
  baseUrl: string,
  model: string,
  work: WorkFull
): Promise<string> {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: "system", content: "你是一位严谨的中国古典文学教授。" },
      { role: "user", content: buildPrompt(work) },
    ],
    max_tokens: 600,
    temperature: 0.4,
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MiniMax ${res.status} ${res.statusText} ${text}`.trim());
  }
  const json = (await res.json()) as ChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("MiniMax response missing choices[0].message.content");
  return content;
}

// GET /api/insights/:poemId — return the cached insight, or 404 if none.
insights.get("/:poemId", async (c) => {
  const poemId = c.req.param("poemId");
  const row = await c.env.DB
    .prepare(
      "SELECT id, translation, context, themes, model, created_at FROM insights WHERE poem_id = ? LIMIT 1"
    )
    .bind(poemId)
    .first<{
      id: string;
      translation: string;
      context: string;
      themes: string;
      model: string;
      created_at: string;
    }>();
  if (!row) return c.json({ success: false, error: "Insight not generated yet" }, 404);
  cachePublic(c, 60, 300);
  return c.json({
    success: true,
    data: {
      ...row,
      themes: row.themes.split(/[、,,;\s]+/).filter(Boolean),
    },
  });
});

// POST /api/insights/generate — body { poem_id }
// Looks up the work, calls MiniMax for a fresh insight, persists the
// result keyed by poem_id. If a cached insight exists, returns it
// without making a new AI call.
insights.post("/generate", async (c) => {
  let payload: { poem_id?: string };
  try {
    payload = (await c.req.json()) as { poem_id?: string };
  } catch {
    return c.json({ success: false, error: "无效 JSON body" }, 400);
  }
  const poemId = payload?.poem_id;
  if (!poemId) return c.json({ success: false, error: "poem_id required" }, 400);

  // Cache hit?
  const cached = await c.env.DB
    .prepare(
      "SELECT id, translation, context, themes, model, created_at FROM insights WHERE poem_id = ? LIMIT 1"
    )
    .bind(poemId)
    .first<{
      id: string;
      translation: string;
      context: string;
      themes: string;
      model: string;
      created_at: string;
    }>();
  if (cached) {
    return c.json({
      success: true,
      data: {
        ...cached,
        themes: cached.themes.split(/[、,,;\s]+/).filter(Boolean),
        cached: true,
      },
    });
  }

  // Fetch work shard
  const shard = await readR2Json<Record<string, WorkFull>>(
    c.env.CONTENT,
    `works-shards/${poemId.slice(0, 2)}.json`
  );
  const work = shard?.[poemId];
  if (!work) return c.json({ success: false, error: "Work not found" }, 404);

  // Call MiniMax
  const baseUrl = c.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const model = c.env.MINIMAX_MODEL || DEFAULT_MODEL;
  let raw = "";
  try {
    raw = await callMinimax(c.env.MINIMAX_API_KEY, baseUrl, model, work);
  } catch (err) {
    return c.json(
      { success: false, error: `AI 调用失败: ${(err as Error).message}` },
      502
    );
  }

  const parsed = parseInsightResponse(raw);
  // The tolerant parser always returns at least one non-empty field, so
  // there is no "model output unparseable" failure mode any more.
  // If the model produced noise, we still persist whatever we have so
  // the user's next request gets the same answer from cache.

  const insightId = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO insights (id, poem_id, translation, context, themes, model, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  )
    .bind(insightId, poemId, parsed.translation, parsed.context, parsed.themes, model)
    .run();

  return c.json({
    success: true,
    data: {
      id: insightId,
      poem_id: poemId,
      translation: parsed.translation,
      context: parsed.context,
      themes: parsed.themes.split(/[、,,;\s]+/).filter(Boolean),
      model,
      cached: false,
    },
  });
});

export default insights;
