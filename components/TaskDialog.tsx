"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Course, DeadlineType } from "@/lib/types";

const TYPES: DeadlineType[] = ["assignment", "quiz", "exam", "discussion", "other"];

/** A local datetime the <input type="datetime-local"> understands. */
function localValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Adds a task of the student's own. It writes to the same `deadlines` table as
 * a synced assignment, tagged source='manual', so every count, projection and
 * view treats it exactly like anything from Canvas — and ingest_sync leaves it
 * alone, because it has no canvas_assignment_id to match on.
 */
export default function TaskDialog({
  open,
  courses,
  defaultDay,
  onClose,
  onSaved,
}: {
  open: boolean;
  courses: Course[];
  defaultDay?: Date | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [type, setType] = useState<DeadlineType>("assignment");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      ref.current?.close();
      return;
    }
    // Default to 11:59pm on the chosen day — DLSU's de facto deadline.
    const base = defaultDay ? new Date(defaultDay) : new Date();
    base.setHours(23, 59, 0, 0);
    setDue(localValue(base));
    setErr(null);
    ref.current?.showModal();
  }, [open, defaultDay]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setErr("Give the task a title.");
    setBusy(true);
    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    const { error } = await sb.from("deadlines").insert({
      user_id: auth.user!.id,
      course_id: courseId || null,
      canvas_assignment_id: null,
      source: "manual",
      title: title.trim().slice(0, 400),
      due_at: due ? new Date(due).toISOString() : null,
      type,
      notes: notes.trim() ? notes.trim() : null,
      status: "open",
    });
    setBusy(false);
    if (error) return setErr(error.message);

    setTitle("");
    setNotes("");
    onSaved();
    onClose();
  }

  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <form style={{ padding: 24 }} onSubmit={save}>
        <div className="stat">Your own task</div>
        <h2 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.04em", margin: "4px 0 16px", textTransform: "uppercase" }}>
          Add task
        </h2>

        <div className="stack">
          <label className="stack" style={{ gap: 5 }}>
            <span className="sectionhead" style={{ margin: 0 }}>
              What
            </span>
            <input
              className="field"
              autoFocus
              value={title}
              placeholder="Start the DIGDACM report"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="stack" style={{ gap: 5, flex: "1 1 160px" }}>
              <span className="sectionhead" style={{ margin: 0 }}>
                Course
              </span>
              <select className="field" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">No course</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 5, flex: "1 1 130px" }}>
              <span className="sectionhead" style={{ margin: 0 }}>
                Kind
              </span>
              <select className="field" value={type} onChange={(e) => setType(e.target.value as DeadlineType)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="stack" style={{ gap: 5 }}>
            <span className="sectionhead" style={{ margin: 0 }}>
              Due
            </span>
            <input className="field" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            <span className="note">Leave it empty for something with no date.</span>
          </label>

          <label className="stack" style={{ gap: 5 }}>
            <span className="sectionhead" style={{ margin: 0 }}>
              Notes
            </span>
            <input className="field" value={notes} placeholder="optional" onChange={(e) => setNotes(e.target.value)} />
          </label>

          {err && <p className="err">{err}</p>}

          <div className="nav">
            <button className="btn" data-primary="true" type="submit" disabled={busy}>
              Add task
            </button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
