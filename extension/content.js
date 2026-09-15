/**
 * Runs on the student's own AnimoSpace tab. Canvas is a SPA over its own REST
 * API, and that API answers to the page's session cookie — which is why the
 * scraping has to happen here rather than server-side with a token DLSU does
 * not issue to students.
 *
 * It only ever reads the signed-in student's own enrolments.
 */

const POLL_MS = 15 * 60 * 1000; // conservative on purpose; DLSU's servers are shared
const PAGE_SIZE = 100;
const GAP_MS = 350; // between Canvas calls
const MAX_BACKOFF_MS = 30 * 60 * 1000;

let backoffMs = 0;
let syncing = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {}

/** Canvas paginates with a Link header; follow rel="next" until it runs out. */
async function canvasGet(path) {
  let url = new URL(path, location.origin).toString();
  const all = [];
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json+canvas-string-ids" } });
    if (res.status === 403) throw new RateLimited("Canvas rate limited or denied access");
    if (!res.ok) return all;
    const body = await res.json();
    if (Array.isArray(body)) all.push(...body);
    else return body;

    const link = res.headers.get("Link") ?? "";
    const next = link.split(",").find((p) => p.includes('rel="next"'));
    url = next ? next.slice(next.indexOf("<") + 1, next.indexOf(">")) : "";
    if (url) await sleep(GAP_MS);
  }
  return all;
}

const stripHtml = (html) =>
  (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Canvas embeds attachments as /files/<id> links in the assignment body. */
function fileIdsIn(html) {
  const ids = new Set();
  for (const m of (html ?? "").matchAll(/\/files\/(\d+)/g)) ids.add(m[1]);
  return [...ids];
}

function classify(assignment) {
  const types = assignment.submission_types ?? [];
  const name = (assignment.name ?? "").toLowerCase();
  if (types.includes("online_quiz") || assignment.is_quiz_assignment) return "quiz";
  if (types.includes("discussion_topic")) return "discussion";
  if (/\b(final|midterm|exam)\b/.test(name)) return "exam";
  return "assignment";
}

function statusOf(assignment) {
  const s = assignment.submission;
  if (!s) return "open";
  if (s.workflow_state === "graded" || s.score != null) return "graded";
  if (s.submitted_at) return "submitted";
  return "open";
}

async function collect() {
  const courses = await canvasGet(
    `/api/v1/courses?enrollment_state=active&per_page=${PAGE_SIZE}&include[]=teachers&include[]=course_image`,
  );

  const payload = { courses: [], deadlines: [], files: [] };

  for (const course of courses) {
    if (!course?.id || course.access_restricted_by_date) continue;
    payload.courses.push({
      canvas_course_id: String(course.id),
      // DLSU course names look like "MICPROS - Microprocessors"; course_code is the short one.
      code: (course.course_code ?? course.name ?? "").split(/\s|-/)[0].slice(0, 32) || String(course.id),
      name: course.name ?? course.course_code ?? "Course",
      instructor: course.teachers?.[0]?.display_name ?? null,
    });

    await sleep(GAP_MS);
    const assignments = await canvasGet(
      `/api/v1/courses/${course.id}/assignments?per_page=${PAGE_SIZE}&include[]=submission&order_by=due_at`,
    );

    const wantedFileIds = new Map(); // canvas_file_id -> canvas_assignment_id
    for (const a of assignments) {
      if (!a?.id) continue;
      payload.deadlines.push({
        canvas_course_id: String(course.id),
        canvas_assignment_id: String(a.id),
        title: a.name ?? stripHtml(a.description).slice(0, 80) ?? "Untitled",
        due_at: a.due_at ?? null,
        type: classify(a),
        points_possible: typeof a.points_possible === "number" ? a.points_possible : null,
        canvas_url: a.html_url ?? null,
        status: statusOf(a),
      });
      for (const id of fileIdsIn(a.description)) wantedFileIds.set(id, String(a.id));
    }

    // Student file access is often restricted; a 403 here is normal, not fatal.
    await sleep(GAP_MS);
    let courseFiles = [];
    try {
      courseFiles = await canvasGet(`/api/v1/courses/${course.id}/files?per_page=${PAGE_SIZE}`);
    } catch (e) {
      if (e instanceof RateLimited) throw e;
    }

    for (const f of courseFiles) {
      if (!f?.id) continue;
      payload.files.push({
        canvas_course_id: String(course.id),
        canvas_assignment_id: wantedFileIds.get(String(f.id)) ?? null,
        canvas_file_id: String(f.id),
        filename: f.display_name ?? f.filename ?? "file",
        content_type: f["content-type"] ?? f.content_type ?? null,
        size_bytes: typeof f.size === "number" ? f.size : null,
        canvas_url: f.url ?? null,
      });
    }

    // Files linked from an assignment but missing from the course listing still
    // deserve a row, so the deadline shows its attachments.
    const listed = new Set(courseFiles.map((f) => String(f.id)));
    for (const [fileId, assignmentId] of wantedFileIds) {
      if (listed.has(fileId)) continue;
      payload.files.push({
        canvas_course_id: String(course.id),
        canvas_assignment_id: assignmentId,
        canvas_file_id: fileId,
        filename: `Attachment ${fileId}`,
        canvas_url: `${location.origin}/courses/${course.id}/files/${fileId}`,
      });
    }

    await sleep(GAP_MS);
  }

  return payload;
}

async function sync(trigger) {
  if (syncing) return;
  const { syncToken, appUrl } = await chrome.storage.sync.get(["syncToken", "appUrl"]);
  if (!syncToken || !appUrl) return;

  syncing = true;
  try {
    const payload = await collect();
    const res = await fetch(new URL("/api/sync", appUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${syncToken}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `sync failed (${res.status})`);

    backoffMs = 0;
    await chrome.storage.sync.set({
      lastSync: new Date().toISOString(),
      lastResult: `${body.counts?.deadlines ?? 0} deadlines across ${body.counts?.courses ?? 0} courses (${trigger})`,
    });
    console.info("[planner] synced", body.counts);
  } catch (e) {
    // Back off hard so a broken sync never turns into repeated hammering.
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : POLL_MS, MAX_BACKOFF_MS);
    await chrome.storage.sync.set({ lastError: `${new Date().toISOString()} — ${e.message}` });
    console.warn("[planner] sync failed, backing off", backoffMs / 60000, "min:", e.message);
    await sleep(backoffMs);
  } finally {
    syncing = false;
  }
}

sync("page load");
setInterval(() => sync("interval"), POLL_MS);
