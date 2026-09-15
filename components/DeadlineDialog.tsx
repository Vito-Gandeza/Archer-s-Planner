"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { timeUntil } from "@/lib/planner.mjs";
import type { Course, CourseFile, Deadline } from "@/lib/types";

export function Clock({ date }: { date: Date }) {
  const h = date.getHours();
  const m = date.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return (
    <>
      {h12}:{String(m).padStart(2, "0")}
      <span className="mer">{h < 12 ? "AM" : "PM"}</span>
    </>
  );
}

export default function DeadlineDialog({
  deadline,
  course,
  files,
  now,
  onClose,
  onChanged,
}: {
  deadline: Deadline | null;
  course?: Course;
  files: CourseFile[];
  now: Date;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (deadline) ref.current?.showModal();
    else ref.current?.close();
  }, [deadline]);

  const done = deadline ? deadline.status !== "open" : false;

  async function toggle() {
    if (!deadline) return;
    setBusy(true);
    await supabaseBrowser()
      .from("deadlines")
      .update({ status: done ? "open" : "submitted" })
      .eq("id", deadline.id);
    setBusy(false);
    onChanged();
    onClose();
  }

  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {deadline && (
        <div style={{ padding: 24 }}>
          <div className="stat">{course?.name ?? "Course"}</div>
          <div
            style={{ fontSize: 34, fontWeight: 900, letterSpacing: "-0.04em", textTransform: "uppercase", lineHeight: 0.95, marginTop: 4 }}
          >
            {course?.code ?? "—"}
          </div>
          <p style={{ fontSize: 14.5, margin: "12px 0 6px", lineHeight: 1.35 }}>{deadline.title}</p>
          <p className="stat">
            {deadline.due_at ? (
              <>
                <b>
                  {new Date(deadline.due_at).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "short",
                    day: "numeric",
                  })}
                  , <Clock date={new Date(deadline.due_at)} />
                </b>{" "}
                · {timeUntil(deadline.due_at, now)}
              </>
            ) : (
              "No due date"
            )}
            {deadline.points_possible != null && <> · {deadline.points_possible} pts</>}
          </p>

          {files.length > 0 && (
            <>
              <h3 className="sectionhead">Attached files</h3>
              <div className="mini">
                {files.map((f) => (
                  <a key={f.id} className="mini-row" href={f.canvas_url ?? "#"} target="_blank" rel="noreferrer">
                    <span className="nm">{f.filename}</span>
                    <span className="tag">{f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB` : "open"}</span>
                  </a>
                ))}
              </div>
            </>
          )}

          <div className="nav" style={{ marginTop: 22 }}>
            <button className="btn" data-primary="true" onClick={toggle} disabled={busy}>
              {done ? "Reopen" : "Mark done"}
            </button>
            {deadline.canvas_url && (
              <a className="btn btn-ghost" href={deadline.canvas_url} target="_blank" rel="noreferrer">
                Open in Canvas
              </a>
            )}
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
