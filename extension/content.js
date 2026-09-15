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

/** Carries what Canvas actually said, so failures are diagnosable rather than guessed at. */
class CanvasError extends Error {
  constructor(status, url, body) {
    const path = url.replace(location.origin, "");
    const snippet = (body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    super(`${status} on ${path}${snippet ? ` — ${snippet}` : ""}`);
    this.status = status;
    this.path = path;
    this.body = body || "";
  }

  /** Canvas answers 403 both for throttling and for plain "you may not read this". */
  get isRateLimit() {
    return this.status === 403 && /rate limit/i.test(this.body);
  }

  get isAuth() {
    return this.status === 401 || (this.status === 403 && !this.isRateLimit);
  }
}

/** Canvas paginates with a Link header; follow rel="next" until it runs out. */
async function canvasGet(path) {
  let url = new URL(path, location.origin).toString();
  const all = [];
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json+canvas-string-ids" },
    });
    if (!res.ok) throw new CanvasError(res.status, url, await res.text().catch(() => ""));

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
  // Fails loudly: without the course list there is nothing to sync.
  const courses = await canvasGet(`/api/v1/courses?enrollment_state=active&per_page=${PAGE_SIZE}&include[]=teachers`);

  const payload = { courses: [], deadlines: [], files: [] };
  const skipped = [];

  for (const course of courses) {
    if (!course?.id || course.access_restricted_by_date) continue;
    payload.courses.push({
      canvas_course_id: String(course.id),
      // DLSU course names look like "MICPROS - Microprocessors"; course_code is the short one.
      code: (course.course_code ?? course.name ?? "").split(/\s|-/)[0].slice(0, 32) || String(course.id),
      name: course.name ?? course.course_code ?? "Course",
      instructor: course.teachers?.[0]?.display_name ?? null,
    });

    // One locked course must not sink the whole sync.
    let assignments = [];
    await sleep(GAP_MS);
    try {
      assignments = await canvasGet(
        `/api/v1/courses/${course.id}/assignments?per_page=${PAGE_SIZE}&include[]=submission&order_by=due_at`,
      );
    } catch (e) {
      if (e instanceof CanvasError && e.isRateLimit) throw e;
      skipped.push(`${course.course_code ?? course.id}: assignments ${e.status ?? "?"}`);
      continue;
    }

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

    // Student file listing is often restricted; a 403 here is normal, not fatal.
    await sleep(GAP_MS);
    let courseFiles = [];
    try {
      courseFiles = await canvasGet(`/api/v1/courses/${course.id}/files?per_page=${PAGE_SIZE}`);
    } catch (e) {
      if (e instanceof CanvasError && e.isRateLimit) throw e;
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

  return { payload, skipped };
}

/** Turns a failure into something a human can act on, not just a status code. */
function describe(e) {
  if (!(e instanceof CanvasError)) return e.message;
  if (e.isRateLimit) return `Canvas is rate limiting this session (${e.path}). Backing off.`;
  if (e.status === 401) return `Canvas says you are not signed in (${e.path}). Open AnimoSpace and log in, then retry.`;
  if (e.status === 403) return `Canvas refused the request (${e.path}). ${e.body.slice(0, 120)}`;
  return e.message;
}

async function sync(trigger) {
  if (syncing) return;
  const { syncToken, appUrl } = await chrome.storage.sync.get(["syncToken", "appUrl"]);
  if (!syncToken || !appUrl) return;

  syncing = true;
  try {
    const { payload, skipped } = await collect();
    const res = await fetch(new URL("/api/sync", appUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${syncToken}` },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `planner rejected the sync (${res.status})`);

    backoffMs = 0;
    await chrome.storage.sync.set({
      lastSync: new Date().toISOString(),
      lastResult:
        `${body.counts?.deadlines ?? 0} deadlines across ${body.counts?.courses ?? 0} courses (${trigger})` +
        (skipped.length ? ` — skipped ${skipped.join(", ")}` : ""),
      lastError: "",
    });
    console.info("[planner] synced", body.counts);
  } catch (e) {
    // Back off hard so a broken sync never turns into repeated hammering.
    backoffMs = Math.min(backoffMs ? backoffMs * 2 : POLL_MS, MAX_BACKOFF_MS);
    await chrome.storage.sync.set({ lastError: `${new Date().toISOString()} — ${describe(e)}` });
    console.warn("[planner] sync failed, backing off", backoffMs / 60000, "min:", e);
    await sleep(backoffMs);
  } finally {
    syncing = false;
  }
}

// The login page is on the same host but has no session yet; syncing there just
// produces a confusing 401.
if (!/^\/login/.test(location.pathname)) {
  sync("page load");
  setInterval(() => sync("interval"), POLL_MS);
}
