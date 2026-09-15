import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cheapest current tier, and enough for pulling a weights table out of a syllabus.
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const MAX_BYTES = 8 * 1024 * 1024;

const PROMPT = `You are reading a university course syllabus.

Find the grade breakdown: the table or list saying how the final grade is
weighted (e.g. "Quizzes 30%, Machine Problems 20%, Final Exam 25%").

Reply with JSON only, no prose and no code fence, in exactly this shape:

{"components":[{"label":"Quizzes","weight_percent":30}],"confidence":"high","note":""}

Rules:
- weight_percent is a number, not a string, and excludes the percent sign.
- Use the syllabus's own wording for label. Do not invent components.
- Keep sub-items only if the parent's weight is not stated.
- If no breakdown is present, return {"components":[],"confidence":"low","note":"<why>"}.
- confidence is "high", "medium" or "low".`;

type Extracted = { label: string; weight_percent: number };

/** The model's reply is untrusted input: parse defensively before it reaches the DB. */
function parseComponents(raw: string): { components: Extracted[]; confidence: string; note: string } {
  const start = raw.indexOf("{");
  const stop = raw.lastIndexOf("}");
  if (start === -1 || stop <= start) throw new Error("model did not return JSON");
  const parsed = JSON.parse(raw.slice(start, stop + 1)) as Record<string, unknown>;

  const list = Array.isArray(parsed.components) ? parsed.components : [];
  const components = list
    .map((c) => {
      const row = c as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label.trim().slice(0, 120) : "";
      const weight = Number(row.weight_percent);
      return { label, weight_percent: weight };
    })
    .filter((c) => c.label && Number.isFinite(c.weight_percent) && c.weight_percent >= 0 && c.weight_percent <= 100)
    .slice(0, 40);

  return {
    components,
    confidence: typeof parsed.confidence === "string" ? parsed.confidence : "low",
    note: typeof parsed.note === "string" ? parsed.note.slice(0, 400) : "",
  };
}

/**
 * Body: { courseId, storagePath, force? }
 * `storagePath` points at the private course-files bucket; the signed-in user's
 * RLS policy is what decides whether they may read it.
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server" }, { status: 500 });
  }

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { courseId, storagePath, force } = (await request.json()) as {
    courseId?: string;
    storagePath?: string;
    force?: boolean;
  };
  if (!courseId || !storagePath) return NextResponse.json({ error: "courseId and storagePath required" }, { status: 400 });

  // Parse once per course and reuse the result; re-running costs money for nothing.
  const { data: existing } = await sb
    .from("grade_components")
    .select("id")
    .eq("course_id", courseId)
    .eq("source", "ai_extracted");
  if (existing?.length && !force) {
    return NextResponse.json({ cached: true, components: existing.length });
  }

  const { data: blob, error: dlError } = await sb.storage.from("course-files").download(storagePath);
  if (dlError || !blob) return NextResponse.json({ error: dlError?.message ?? "file not found" }, { status: 404 });
  if (blob.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 8 MB" }, { status: 413 });

  const bytes = Buffer.from(await blob.arrayBuffer());
  const isPdf = blob.type === "application/pdf" || storagePath.toLowerCase().endsWith(".pdf");
  const content: Anthropic.MessageParam["content"] = isPdf
    ? [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") },
        },
        { type: "text", text: PROMPT },
      ]
    : [{ type: "text", text: `${PROMPT}\n\n--- syllabus ---\n${bytes.toString("utf8").slice(0, 200_000)}` }];

  const client = new Anthropic();
  let raw: string;
  try {
    const message = await client.messages.create({ model: MODEL, max_tokens: 4000, messages: [{ role: "user", content }] });
    raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (e) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: e.message }, { status: e.status ?? 502 });
    throw e;
  }

  let result;
  try {
    result = parseComponents(raw);
  } catch {
    return NextResponse.json({ error: "could not read a grade breakdown out of that file" }, { status: 422 });
  }
  if (!result.components.length) {
    return NextResponse.json({ components: [], confidence: result.confidence, note: result.note });
  }

  await sb.from("grade_components").delete().eq("course_id", courseId).eq("source", "ai_extracted");
  const { error } = await sb.from("grade_components").insert(
    result.components.map((c) => ({
      user_id: auth.user!.id,
      course_id: courseId,
      label: c.label,
      weight_percent: c.weight_percent,
      source: "ai_extracted" as const,
    })),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ components: result.components, confidence: result.confidence, note: result.note });
}
