"use client";

import { useRef, useState } from "react";
import { Masthead } from "@/components/Chrome";
import { useSnapshot } from "@/lib/useSnapshot";
import { CANVAS_ORIGIN } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase-browser";

/** Rank likely syllabi to the top of the picker without hiding anything else. */
function score(filename: string) {
  const n = filename.toLowerCase();
  if (/syllabus|course\s*outline|coursepack|course\s*guide/.test(n)) return 3;
  if (/outline|orientation|overview|grading/.test(n)) return 2;
  if (n.endsWith(".pdf")) return 1;
  return 0;
}

export default function Settings() {
  const { snapshot, refresh } = useSnapshot();
  const [token, setToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [fileId, setFileId] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const courses = snapshot?.courses ?? [];
  // The management list below needs every course, hidden ones included, so they
  // can be unhidden — but there is no sense offering a hidden course a syllabus.
  const activeCourses = courses.filter((c) => !c.hidden);

  /** Files already pulled from Canvas for the chosen course, likeliest first. */
  const syncedFiles = (snapshot?.files ?? [])
    .filter((f) => f.course_id === courseId)
    .sort((a, b) => score(b.filename) - score(a.filename) || a.filename.localeCompare(b.filename));

  async function mint() {
    setBusy(true);
    const res = await fetch("/api/sync-token", { method: "POST" });
    const body = await res.json();
    setBusy(false);
    if (body.token) {
      setToken(body.token);
      setMsg("Copy this now — it is not shown again. Any previous token is revoked.");
    } else setMsg(body.error ?? "Could not create a token.");
  }

  async function revoke() {
    setBusy(true);
    await fetch("/api/sync-token", { method: "DELETE" });
    setBusy(false);
    setToken(null);
    setMsg("All sync tokens revoked. The extension will stop syncing.");
  }

  async function parseSyllabus(e: React.FormEvent) {
    e.preventDefault();
    if (!courseId) return setMsg("Pick a course first.");
    const upload = fileInput.current?.files?.[0];
    if (!fileId && !upload) return setMsg("Pick a synced file, or choose one from your computer.");

    setBusy(true);
    let body: Record<string, unknown> = { courseId, force: true };

    if (fileId) {
      setMsg("Reading the grade breakdown…");
      body = { ...body, fileId };
    } else {
      setMsg("Uploading…");
      const sb = supabaseBrowser();
      const { data: auth } = await sb.auth.getUser();
      const path = `${auth.user!.id}/${courseId}/${upload!.name}`;
      const up = await sb.storage.from("course-files").upload(path, upload!, { upsert: true });
      if (up.error) {
        setBusy(false);
        return setMsg(up.error.message);
      }
      setMsg("Reading the grade breakdown…");
      body = { ...body, storagePath: path };
    }

    const res = await fetch("/api/parse-syllabus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(out.error ?? "Parsing failed.");
    setMsg(
      out.components?.length
        ? `Found ${out.components.length} components (confidence: ${out.confidence}) in ${out.file}. Check them on the Grades page.`
        : `No breakdown found in ${out.file ?? "that file"}. ${out.note ?? ""}`,
    );
    refresh();
  }

  /**
   * Hiding is the everyday action, and the one that actually works: a deleted
   * course reappears on the next sync because Canvas still lists it, whereas
   * `hidden` is never written by ingest_sync and so survives. A hidden course
   * and everything under it drops out of every other screen.
   */
  async function toggleHidden(id: string, hidden: boolean) {
    const { error } = await supabaseBrowser().from("courses").update({ hidden }).eq("id", id);
    if (error) setMsg(error.message);
    refresh();
  }

  /**
   * Deleting is the rare one: it takes the course's deadlines, files, modules
   * and grade breakdown with it, and the next sync will bring the course back
   * anyway unless it is also out of term. Kept for real cleanup, armed first.
   */
  async function removeCourse(id: string) {
    setBusy(true);
    const { error } = await supabaseBrowser().from("courses").delete().eq("id", id);
    setBusy(false);
    setConfirming(null);
    setMsg(error ? error.message : "Course removed.");
    refresh();
  }

  const countsFor = (id: string) => ({
    deadlines: (snapshot?.deadlines ?? []).filter((d) => d.course_id === id).length,
    files: (snapshot?.files ?? []).filter((f) => f.course_id === id).length,
    items: (snapshot?.moduleItems ?? []).filter((i) => i.course_id === id).length,
  });

  return (
    <div className="shell narrow">
      <Masthead title="Settings" onSynced={refresh}>
        <p className="dek">Sync token, extension setup, syllabus parsing, courses</p>
      </Masthead>

      {msg && (
        <p className="err" style={{ marginTop: 16 }}>
          {msg}
        </p>
      )}

      <h2 className="sectionhead">1 — Sync token</h2>
      <div className="card stack">
        <p className="note" style={{ marginTop: 0 }}>
          The extension sends this as a bearer token so the server knows which account to write to. Only a hash is
          stored, so a lost token has to be regenerated rather than looked up.
        </p>
        {token && <p className="mono">{token}</p>}
        <div className="nav">
          <button className="btn" data-primary="true" onClick={mint} disabled={busy}>
            Generate token
          </button>
          <button className="btn btn-ghost" onClick={revoke} disabled={busy}>
            Revoke all
          </button>
        </div>
      </div>

      <h2 className="sectionhead">2 — Install the extension</h2>
      <div className="card">
        <ol className="note" style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            Open <span className="mono">chrome://extensions</span> (or <span className="mono">brave://extensions</span>)
            and turn on Developer mode.
          </li>
          <li>
            Load unpacked, and pick the <span className="mono">extension/</span> folder of this project.
          </li>
          <li>Open the extension&apos;s Options, paste the sync token and this app&apos;s URL, and save.</li>
          <li>
            Open{" "}
            <a href={CANVAS_ORIGIN} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              AnimoSpace
            </a>{" "}
            and stay signed in. It syncs on load and every 15 minutes while the tab is open.
          </li>
        </ol>
      </div>

      <h2 className="sectionhead">3 — Read a syllabus</h2>
      <form className="card stack" onSubmit={parseSyllabus}>
        <p className="note" style={{ marginTop: 0 }}>
          Pick a file the extension already pulled from Canvas — no re-uploading. It goes to Gemini once and the result
          is cached per course, so it only re-runs when you ask it to.
        </p>
        <select
          className="field"
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setFileId("");
          }}
        >
          <option value="">Choose a course…</option>
          {activeCourses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>

        {courseId && (
          <select className="field" value={fileId} onChange={(e) => setFileId(e.target.value)}>
            <option value="">
              {syncedFiles.length ? "Choose a synced file…" : "No files synced for this course yet"}
            </option>
            {syncedFiles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.filename}
                {f.parsed_at ? " (read before)" : ""}
              </option>
            ))}
          </select>
        )}

        <details>
          <summary className="note" style={{ cursor: "pointer" }}>
            Or upload one from your computer
          </summary>
          <input
            className="field"
            style={{ marginTop: 8 }}
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md,text/plain,application/pdf"
            onChange={() => setFileId("")}
          />
        </details>

        <div className="nav">
          <button className="btn" data-primary="true" type="submit" disabled={busy}>
            Extract grade breakdown
          </button>
        </div>
      </form>

      <h2 className="sectionhead">Your courses</h2>
      <div className="card">
        <p className="note" style={{ marginTop: 0 }}>
          <b>Hide</b> is the one you want. AnimoSpace enrols you in org and admin shells alongside real classes, and
          they come back on every sync no matter how often you delete them — hiding sticks, because a sync never
          touches it. A hidden course and all of its deadlines, files and modules disappear from every other screen.
          <br />
          <br />
          The <b>×</b> deletes permanently instead, which is only worth it for a course Canvas has stopped listing.
        </p>
        {courses.length === 0 && <div className="hatchbox">No courses synced yet</div>}
        {courses.map((c) => {
          const n = countsFor(c.id);
          return (
            <div className="course-row" key={c.id} data-hidden={c.hidden}>
              <span className="code">{c.code}</span>
              <span className="nm" title={c.name}>
                {c.name}
                <br />
                <span className="stat">
                  {n.deadlines} deadline{n.deadlines === 1 ? "" : "s"} · {n.files} file{n.files === 1 ? "" : "s"} ·{" "}
                  {n.items} module item{n.items === 1 ? "" : "s"}
                </span>
              </span>
              <span className="nav">
                <button
                  className="btn btn-ghost"
                  onClick={() => toggleHidden(c.id, !c.hidden)}
                  title={c.hidden ? "Show this course everywhere again" : "Hide this course from every other screen"}
                >
                  {c.hidden ? "Show" : "Hide"}
                </button>
                {confirming === c.id ? (
                  <>
                    <button className="btn danger" onClick={() => removeCourse(c.id)} disabled={busy}>
                      Delete for good
                    </button>
                    <button className="btn btn-ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost" onClick={() => setConfirming(c.id)} title="Delete permanently">
                    ×
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <h2 className="sectionhead">Account</h2>
      <div className="nav">
        <button
          className="btn btn-ghost"
          onClick={async () => {
            await supabaseBrowser().auth.signOut();
            window.location.href = "/login";
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
