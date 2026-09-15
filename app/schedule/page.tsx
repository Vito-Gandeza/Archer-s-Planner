"use client";

import { useState } from "react";
import { Masthead, PanelHead } from "@/components/Chrome";
import { useSnapshot } from "@/lib/useSnapshot";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { formatTime, meetingsForDay, dayLoadMinutes } from "@/lib/planner.mjs";
import type { ClassMeeting } from "@/lib/types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MODES = ["lecture", "laboratory", "online"] as const;

/** Postgres hands back "09:15:00"; <input type="time"> wants "09:15". */
const toInput = (t: string) => t.slice(0, 5);

export default function SchedulePage() {
  const { snapshot, stale, refresh } = useSnapshot();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const courses = snapshot?.courses ?? [];
  const meetings = snapshot?.meetings ?? [];

  async function addMeeting(weekday: number) {
    if (!courses.length) return setMsg("Sync your courses first — a class needs a course to belong to.");
    setBusy(true);
    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    const { error } = await sb.from("class_meetings").insert({
      user_id: auth.user!.id,
      course_id: courses[0].id,
      weekday,
      starts_at: "09:15",
      ends_at: "10:45",
      mode: "lecture",
    });
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg(null);
    refresh();
  }

  async function patch(id: string, change: Partial<ClassMeeting>) {
    const { error } = await supabaseBrowser().from("class_meetings").update(change).eq("id", id);
    // The table enforces ends_at > starts_at, so a bad edit is refused rather
    // than silently stored — surface that instead of swallowing it.
    if (error) setMsg(error.message.includes("check") ? "A class has to end after it starts." : error.message);
    else setMsg(null);
    refresh();
  }

  async function remove(id: string) {
    await supabaseBrowser().from("class_meetings").delete().eq("id", id);
    refresh();
  }

  const weeklyMinutes = DAYS.reduce((sum, _d, i) => sum + (dayLoadMinutes(meetings, i) as number), 0);

  return (
    <div className="shell">
      <Masthead title="Schedule" onSynced={refresh}>
        <p className="dek">
          {meetings.length} weekly class{meetings.length === 1 ? "" : "es"} ·{" "}
          {Math.round((weeklyMinutes / 60) * 10) / 10} hr a week
          {stale && " · offline copy"}
        </p>
      </Masthead>

      <p className="note" style={{ marginTop: 18, maxWidth: "62ch" }}>
        Canvas does not publish meeting times, so these are yours to enter — once. They show up on the dashboard as
        today&apos;s classes and sit behind your deadlines on the timeline.
      </p>
      {msg && <p className="err">{msg}</p>}

      {DAYS.map((day, weekday) => {
        const rows = meetingsForDay(meetings, weekday) as ClassMeeting[];
        const load = dayLoadMinutes(meetings, weekday) as number;
        return (
          <section className="panel" key={day}>
            <PanelHead title={day} count={load ? `${Math.round((load / 60) * 10) / 10} hr` : "free"} />

            {rows.length > 0 && (
              <div className="sched-row head">
                <span>Course</span>
                <span>Mode</span>
                <span>Start</span>
                <span>End</span>
                <span>Room</span>
                <span>Span</span>
                <span />
              </div>
            )}

            {rows.map((m) => (
              <div className="sched-row" key={m.id}>
                <select className="field" value={m.course_id} onChange={(e) => patch(m.id, { course_id: e.target.value })}>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
                <select
                  className="field"
                  value={m.mode}
                  onChange={(e) => patch(m.id, { mode: e.target.value as ClassMeeting["mode"] })}
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
                <input
                  className="field"
                  type="time"
                  defaultValue={toInput(m.starts_at)}
                  onBlur={(e) => e.target.value && patch(m.id, { starts_at: e.target.value })}
                />
                <input
                  className="field"
                  type="time"
                  defaultValue={toInput(m.ends_at)}
                  onBlur={(e) => e.target.value && patch(m.id, { ends_at: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="Room"
                  defaultValue={m.room ?? ""}
                  onBlur={(e) => e.target.value !== (m.room ?? "") && patch(m.id, { room: e.target.value || null })}
                />
                <span className="stat">
                  {formatTime(m.starts_at)}–{formatTime(m.ends_at)}
                </span>
                <button className="btn btn-ghost danger" onClick={() => remove(m.id)} aria-label="Remove class">
                  ×
                </button>
              </div>
            ))}

            {rows.length === 0 && <div className="hatchbox">No classes</div>}

            <div className="nav" style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={() => addMeeting(weekday)} disabled={busy}>
                Add class
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
