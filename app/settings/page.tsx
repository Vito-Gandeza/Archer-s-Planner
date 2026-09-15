"use client";

import { useRef, useState } from "react";
import { Masthead } from "@/components/Chrome";
import { useSnapshot } from "@/lib/useSnapshot";
import { CANVAS_ORIGIN } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase-browser";


export default function Settings() {
  const { snapshot, refresh } = useSnapshot();
  const [token, setToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [courseId, setCourseId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const courses = snapshot?.courses ?? [];

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
    const file = fileInput.current?.files?.[0];
    if (!file || !courseId) return setMsg("Pick a course and a syllabus file.");
    setBusy(true);
    setMsg("Uploading…");

    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    const path = `${auth.user!.id}/${courseId}/${file.name}`;
    const up = await sb.storage.from("course-files").upload(path, file, { upsert: true });
    if (up.error) {
      setBusy(false);
      return setMsg(up.error.message);
    }

    setMsg("Reading the grade breakdown…");
    const res = await fetch("/api/parse-syllabus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId, storagePath: path, force: true }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(body.error ?? "Parsing failed.");
    setMsg(
      body.components?.length
        ? `Found ${body.components.length} components (confidence: ${body.confidence}). Check them on the Grades page.`
        : `No breakdown found. ${body.note ?? ""}`,
    );
    refresh();
  }

  return (
    <div className="shell narrow">
      <Masthead title="Settings" onSynced={refresh}>
        <p className="dek">Sync token, extension setup, syllabus parsing</p>
      </Masthead>

      {msg && <p className="err" style={{ marginTop: 16 }}>{msg}</p>}

      <h2 className="sectionhead">1 — Sync token</h2>
      <div className="card stack">
        <p className="note">
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
            Open <a href={CANVAS_ORIGIN} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>AnimoSpace</a>{" "}
            and stay signed in. It syncs on load and every 15 minutes while the tab is open.
          </li>
        </ol>
      </div>

      <h2 className="sectionhead">3 — Read a syllabus</h2>
      <form className="card stack" onSubmit={parseSyllabus}>
        <p className="note">
          Uploads the file to your private storage bucket, then runs it through Gemini once to pull out the grade
          weights. The result is cached per course — it only re-runs when you upload again.
        </p>
        <select className="field" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Choose a course…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
        <input className="field" ref={fileInput} type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" />
        <div className="nav">
          <button className="btn" data-primary="true" type="submit" disabled={busy}>
            Extract grade breakdown
          </button>
        </div>
      </form>

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
