import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { extractJson, generateJson, GeminiError } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "application/pdf"];

const PROMPT = `This image is a university student's weekly class schedule.

Read every class meeting out of it. One entry per course per day: a course that
meets Tuesday and Friday is two entries.

Rules:
- course_code is the short code as printed (for example MICPROS, LBYCPB3, ECNOMIC).
  Use the code, not the long course title.
- day is the full English weekday name.
- start and end are 24-hour "HH:MM". A schedule reading 9:15 AM to 10:45 AM is
  "09:15" and "10:45".
- room is the room label if one is printed, otherwise an empty string.
- mode is "laboratory" if the entry is marked as a lab, "online" if it is marked
  online or has no physical room, otherwise "lecture".
- Ignore free periods, breaks and anything that is not a class meeting.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    meetings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          course_code: { type: "STRING" },
          day: {
            type: "STRING",
            enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          },
          start: { type: "STRING" },
          end: { type: "STRING" },
          room: { type: "STRING" },
          mode: { type: "STRING", enum: ["lecture", "laboratory", "online"] },
        },
        required: ["course_code", "day", "start", "end", "room", "mode"],
        propertyOrdering: ["course_code", "day", "start", "end", "room", "mode"],
      },
    },
    note: { type: "STRING" },
  },
  required: ["meetings", "note"],
  propertyOrdering: ["meetings", "note"],
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "MICPROS - EA4", "micpros" and "MICPROS" all have to land on the same course. */
const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Body: { storagePath }  — an image (or PDF) of the student's timetable, already
 * uploaded to their own prefix in the private bucket.
 *
 * Writes class_meetings for every row it can match to a synced course, and
 * reports the codes it could not place rather than inventing courses.
 */
export async function POST(request: Request) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { storagePath, replace } = (await request.json()) as { storagePath?: string; replace?: boolean };
  if (!storagePath) return NextResponse.json({ error: "storagePath required" }, { status: 400 });

  const { data: blob, error: dlError } = await sb.storage.from("course-files").download(storagePath);
  if (dlError || !blob) return NextResponse.json({ error: dlError?.message ?? "file not found" }, { status: 404 });
  if (blob.size > MAX_BYTES) return NextResponse.json({ error: "image is larger than 8 MB" }, { status: 413 });

  const mime = ALLOWED.includes(blob.type) ? blob.type : "image/png";
  const bytes = Buffer.from(await blob.arrayBuffer());

  let raw: string;
  try {
    raw = await generateJson([{ inline_data: { mime_type: mime, data: bytes.toString("base64") } }, { text: PROMPT }], RESPONSE_SCHEMA);
  } catch (e) {
    if (e instanceof GeminiError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJson(raw);
  } catch {
    return NextResponse.json({ error: "could not read a schedule out of that image" }, { status: 422 });
  }

  const { data: courses } = await sb.from("courses").select("id, code, name");
  const byCode = new Map((courses ?? []).map((c) => [normalise(c.code), c.id as string]));

  const rows: { course_code: string; weekday: number; starts_at: string; ends_at: string; room: string | null; mode: string }[] =
    [];
  const unmatched = new Set<string>();
  const rejected: string[] = [];

  for (const m of Array.isArray(parsed.meetings) ? parsed.meetings.slice(0, 80) : []) {
    const row = m as Record<string, unknown>;
    const code = typeof row.course_code === "string" ? row.course_code.trim() : "";
    const weekday = DAYS.indexOf(String(row.day ?? "").trim().toLowerCase());
    const start = String(row.start ?? "").trim();
    const end = String(row.end ?? "").trim();
    const mode = ["lecture", "laboratory", "online"].includes(String(row.mode)) ? String(row.mode) : "lecture";

    if (!code || weekday === -1 || !HHMM.test(start) || !HHMM.test(end)) {
      rejected.push(`${code || "?"} ${row.day ?? "?"} ${start || "?"}-${end || "?"}`);
      continue;
    }
    // The table's own CHECK would reject this; catching it here gives a reason.
    if (start >= end) {
      rejected.push(`${code} ${row.day} ${start}-${end} (ends before it starts)`);
      continue;
    }

    rows.push({
      course_code: code,
      weekday,
      starts_at: start,
      ends_at: end,
      room: typeof row.room === "string" && row.room.trim() ? row.room.trim().slice(0, 60) : null,
      mode,
    });
  }

  const insertable = rows
    .map((r) => {
      // Exact code first, then a prefix match, so "MICPROS - EA4" finds MICPROS.
      const key = normalise(r.course_code);
      let courseId = byCode.get(key);
      if (!courseId) {
        for (const [code, id] of byCode) {
          if (code.startsWith(key) || key.startsWith(code)) {
            courseId = id;
            break;
          }
        }
      }
      if (!courseId) {
        unmatched.add(r.course_code);
        return null;
      }
      return {
        user_id: auth.user!.id,
        course_id: courseId,
        weekday: r.weekday,
        starts_at: r.starts_at,
        ends_at: r.ends_at,
        room: r.room,
        mode: r.mode,
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);

  if (replace) await sb.from("class_meetings").delete().eq("user_id", auth.user.id);

  if (insertable.length) {
    const { error } = await sb.from("class_meetings").insert(insertable);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    added: insertable.length,
    read: rows.length,
    unmatched: [...unmatched],
    rejected,
    note: typeof parsed.note === "string" ? parsed.note.slice(0, 300) : "",
  });
}
