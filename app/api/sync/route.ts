import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { CANVAS_ORIGIN, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

export const runtime = "nodejs";

const LIMITS = { courses: 60, deadlines: 3000, files: 5000 };
const TYPES = new Set(["assignment", "quiz", "exam", "discussion", "other"]);
const STATUSES = new Set(["open", "submitted", "graded", "dismissed"]);

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const cors = {
  "Access-Control-Allow-Origin": CANVAS_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

/**
 * The extension's only write path.
 *
 * Shape is validated here; authorisation happens in Postgres. `ingest_sync` is
 * a security-definer function keyed on the sync token, so this route runs with
 * the ordinary anon key and no service-role secret exists to leak. Nothing in
 * the request body can name a user — the token decides whose rows these are.
 */
export async function POST(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!bearer.startsWith("csp_")) {
    return NextResponse.json({ error: "missing sync token" }, { status: 401, headers: cors });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400, headers: cors });
  }

  const asArray = (v: unknown, cap: number) => (Array.isArray(v) ? v.slice(0, cap) : []);

  const courses = asArray(body.courses, LIMITS.courses)
    .map((c: any) => ({
      canvas_course_id: str(c?.canvas_course_id, 64),
      code: str(c?.code, 64) ?? str(c?.name, 64),
      name: str(c?.name, 300) ?? str(c?.code, 300),
      instructor: str(c?.instructor, 120),
      room: str(c?.room, 60),
    }))
    .filter((c) => c.canvas_course_id && c.code && c.name);

  const deadlines = asArray(body.deadlines, LIMITS.deadlines)
    .map((d: any) => {
      const type = str(d?.type, 20) ?? "assignment";
      const status = str(d?.status, 20) ?? "open";
      return {
        canvas_course_id: str(d?.canvas_course_id, 64),
        canvas_assignment_id: str(d?.canvas_assignment_id, 64),
        title: str(d?.title, 400) ?? "Untitled",
        due_at: iso(d?.due_at),
        type: TYPES.has(type) ? type : "other",
        points_possible: num(d?.points_possible),
        canvas_url: str(d?.canvas_url, 900),
        status: STATUSES.has(status) ? status : "open",
      };
    })
    .filter((d) => d.canvas_course_id && d.canvas_assignment_id);

  const files = asArray(body.files, LIMITS.files)
    .map((f: any) => ({
      canvas_course_id: str(f?.canvas_course_id, 64),
      // Canvas already says which assignment a file hangs off; no NLP guessing.
      canvas_assignment_id: str(f?.canvas_assignment_id, 64),
      canvas_file_id: str(f?.canvas_file_id, 64),
      filename: str(f?.filename, 300) ?? "file",
      content_type: str(f?.content_type, 120),
      size_bytes: num(f?.size_bytes),
      canvas_url: str(f?.canvas_url, 900),
    }))
    .filter((f) => f.canvas_course_id && f.canvas_file_id);

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb.rpc("ingest_sync", {
    p_token: bearer,
    p_payload: { courses, deadlines, files },
  });

  if (error) {
    const unauthorised = /sync token/i.test(error.message);
    return NextResponse.json({ error: error.message }, { status: unauthorised ? 401 : 500, headers: cors });
  }

  return NextResponse.json(data, { headers: cors });
}
