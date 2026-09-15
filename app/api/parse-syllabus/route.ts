import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { extractJson, generateJson, GeminiError } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    components: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, weight_percent: { type: "NUMBER" } },
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

function parseComponents(raw: string): { components: Extracted[]; confidence: string; note: string } {
  const parsed = extractJson(raw);
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
 * Body: { courseId, fileId? , storagePath?, force? }
 *
 * `fileId` points at an already-synced Canvas file — the normal path, since the
 * extension has usually pulled the syllabus already. Canvas's own file URLs
 * carry a signed `verifier`, which is what lets the server fetch one without a
 * session; when that has expired the answer says to re-sync rather than
 * failing vaguely. `storagePath` remains for a file uploaded by hand.
 */
export async function POST(request: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { courseId, fileId, storagePath, force } = (await request.json()) as {
    courseId?: string;
    fileId?: string;
    storagePath?: string;
    force?: boolean;
  };
  if (!courseId || (!fileId && !storagePath)) {
    return NextResponse.json({ error: "courseId and one of fileId or storagePath required" }, { status: 400 });
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

  let bytes: Buffer;
  let isPdf: boolean;
  let label: string;

  if (fileId) {
    // RLS decides whether this row is theirs to read.
    const { data: file } = await sb
      .from("files")
      .select("filename, canvas_url, content_type")
      .eq("id", fileId)
      .maybeSingle();
    if (!file?.canvas_url) {
      return NextResponse.json({ error: "that file has no downloadable URL — try re-syncing" }, { status: 404 });
    }

    const res = await fetch(file.canvas_url, { redirect: "follow" });
    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            res.status === 401 || res.status === 403
              ? "Canvas would not serve that file — its download link has expired. Open AnimoSpace to re-sync, then try again."
              : `Canvas returned ${res.status} for that file`,
        },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "file is larger than 8 MB" }, { status: 413 });
    bytes = buf;
    label = file.filename;
    isPdf = (file.content_type ?? "").includes("pdf") || /\.pdf$/i.test(file.filename) || buf.subarray(0, 4).toString() === "%PDF";
  } else {
    const { data: blob, error } = await sb.storage.from("course-files").download(storagePath!);
    if (error || !blob) return NextResponse.json({ error: error?.message ?? "file not found" }, { status: 404 });
    if (blob.size > MAX_BYTES) return NextResponse.json({ error: "file is larger than 8 MB" }, { status: 413 });
    bytes = Buffer.from(await blob.arrayBuffer());
    label = storagePath!;
    isPdf = blob.type === "application/pdf" || storagePath!.toLowerCase().endsWith(".pdf");
  }

  const parts = isPdf
    ? [{ inline_data: { mime_type: "application/pdf", data: bytes.toString("base64") } }, { text: PROMPT }]
    : [{ text: `${PROMPT}\n\n--- ${label} ---\n${bytes.toString("utf8").slice(0, 200_000)}` }];

  let raw: string;
  try {
    raw = await generateJson(parts, RESPONSE_SCHEMA);
  } catch (e) {
    if (e instanceof GeminiError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let result;
  try {
    result = parseComponents(raw);
  } catch {
    return NextResponse.json({ error: "could not read a grade breakdown out of that file" }, { status: 422 });
  }
  if (!result.components.length) {
    return NextResponse.json({ components: [], confidence: result.confidence, note: result.note, file: label });
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

  if (fileId) await sb.from("files").update({ parsed_at: new Date().toISOString() }).eq("id", fileId);

  return NextResponse.json({ components: result.components, confidence: result.confidence, note: result.note, file: label });
}
