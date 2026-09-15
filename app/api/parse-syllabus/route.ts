import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cheap, multimodal, and plenty for pulling a weights table out of a syllabus.
// Override with GEMINI_MODEL to move up or down a tier.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_BYTES = 8 * 1024 * 1024;

const PROMPT = `You are reading a university course syllabus.

Find the grade breakdown: the table or list saying how the final grade is
weighted (for example "Quizzes 30%, Machine Problems 20%, Final Exam 25%").

Rules:
- weight_percent is a number without the percent sign.
- Use the syllabus's own wording for each label. Do not invent components.
- Keep sub-items only when the parent's own weight is not stated.
- If the document has no grade breakdown, return an empty components list and
  say why in note.`;

/** Gemini's structured-output schema (an OpenAPI subset). */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    components: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          weight_percent: { type: "NUMBER" },
        },
        required: ["label", "weight_percent"],
        propertyOrdering: ["label", "weight_percent"],
      },
    },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    note: { type: "STRING" },
  },
  required: ["components", "confidence", "note"],
  propertyOrdering: ["components", "confidence", "note"],
};

type Extracted = { label: string; weight_percent: number };

/**
 * Even with a response schema, the model's reply is untrusted input: it reaches
 * the database only through this.
 */
function parseComponents(raw: string): { components: Extracted[]; confidence: string; note: string } {
  const start = raw.indexOf("{");
  const stop = raw.lastIndexOf("}");
  if (start === -1 || stop <= start) throw new Error("model did not return JSON");
  const parsed = JSON.parse(raw.slice(start, stop + 1)) as Record<string, unknown>;

  const list = Array.isArray(parsed.components) ? parsed.components : [];
  const components = list
    .map((c) => {
      const row = c as Record<string, unknown>;
      return {
        label: typeof row.label === "string" ? row.label.trim().slice(0, 120) : "",
        weight_percent: Number(row.weight_percent),
      };
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
 *
 * `storagePath` points at the private course-files bucket; the signed-in user's
 * RLS policy is what decides whether they may read it. The API key stays
 * server-side and never reaches the browser or the extension.
 */
export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set on the server" }, { status: 500 });
  }

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { courseId, storagePath, force } = (await request.json()) as {
    courseId?: string;
    storagePath?: string;
    force?: boolean;
  };
  if (!courseId || !storagePath) {
    return NextResponse.json({ error: "courseId and storagePath required" }, { status: 400 });
  }

  // Parse once per course and reuse the result; re-running costs quota for nothing.
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
  const parts = isPdf
    ? [
        { inline_data: { mime_type: "application/pdf", data: bytes.toString("base64") } },
        { text: PROMPT },
      ]
    : [{ text: `${PROMPT}\n\n--- syllabus ---\n${bytes.toString("utf8").slice(0, 200_000)}` }];

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    // Quota and bad-key failures are the common ones; pass the reason through.
    return NextResponse.json({ error: `Gemini: ${detail.slice(0, 300)}` }, { status: res.status === 429 ? 429 : 502 });
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");

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
