"use client";

import { useEffect, useMemo, useState } from "react";
import { Masthead } from "./Chrome";
import WeekGrid from "./WeekGrid";
import DeadlineDialog from "./DeadlineDialog";
import { useSnapshot } from "@/lib/useSnapshot";
import { weekStart, deadlineState, DAY_MS } from "@/lib/planner.mjs";
import type { Deadline, PlannerSnapshot } from "@/lib/types";

/**
 * `fixture` is for the /preview design harness: the real timeline against
 * sample data, without Supabase or the offline cache.
 */
export default function Timeline({ fixture }: { fixture?: PlannerSnapshot }) {
  const live = useSnapshot();
  const snapshot = fixture ?? live.snapshot;
  const stale = fixture ? false : live.stale;
  const refresh = fixture ? () => {} : live.refresh;
  const [offset, setOffset] = useState(0);
  // A seven-day grid is unreadable on a phone, so the default follows the
  // screen: three days on a handset, five on a tablet, the full week on desktop.
  const [days, setDays] = useState(7);
  useEffect(() => {
    const fit = () => setDays(window.innerWidth < 640 ? 3 : window.innerWidth < 1024 ? 5 : 7);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const [selected, setSelected] = useState<Deadline | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const start = useMemo(() => {
    const s = weekStart(now) as Date;
    s.setDate(s.getDate() + offset * 7);
    return s;
  }, [now, offset]);

  const courses = snapshot?.courses ?? [];
  const deadlines = snapshot?.deadlines ?? [];
  const files = snapshot?.files ?? [];
  const meetings = snapshot?.meetings ?? [];
  const courseOf = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const end = new Date(start.getTime() + days * DAY_MS);
  const inWeek = deadlines.filter((d) => {
    if (!d.due_at) return false;
    const t = new Date(d.due_at).getTime();
    return t >= start.getTime() && t < end.getTime();
  });
  const dueToday = inWeek.filter((d) => deadlineState(d, now) === "today");

  const rangeLabel = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} — ${new Date(
    end.getTime() - DAY_MS,
  ).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="shell">
      <Masthead title="Timeline" onSynced={refresh}>
        <p className="dek">
          {inWeek.length} deadline{inWeek.length === 1 ? "" : "s"} · {meetings.length} weekly class
          {meetings.length === 1 ? "" : "es"}
          {dueToday.length > 0 && (
            <>
              {" · "}
              <span className="live">{dueToday.length} due today</span>
            </>
          )}
          {stale && " · offline copy"}
        </p>
      </Masthead>

      <div className="weekbar">
        <div className="range">{rangeLabel}</div>
        <div className="nav">
          <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous week">
            ←
          </button>
          <button onClick={() => setOffset(0)} data-active={offset === 0}>
            This week
          </button>
          <button onClick={() => setOffset((o) => o + 1)} aria-label="Next week">
            →
          </button>
          <button onClick={() => setDays((d) => (d === 7 ? 3 : d === 3 ? 5 : 7))}>{days} days</button>
        </div>
        <div className="legend">
          <span>
            <i className="swatch upcoming" />
            Upcoming
          </span>
          <span>
            <i className="swatch today" />
            Due today
          </span>
          <span>
            <i className="swatch overdue" />
            Overdue
          </span>
          <span>
            <i className="swatch done" />
            Done
          </span>
        </div>
      </div>

      {deadlines.length === 0 && meetings.length === 0 ? (
        <div className="hatchbox" style={{ padding: "64px 24px" }}>
          Nothing to show yet
          <small>Set up the extension from Settings, or add your class schedule.</small>
        </div>
      ) : (
        <WeekGrid
          weekStart={start}
          days={days}
          courses={courses}
          deadlines={deadlines}
          files={files}
          meetings={meetings}
          now={now}
          onSelect={setSelected}
        />
      )}

      <DeadlineDialog
        deadline={selected}
        course={selected ? courseOf.get(selected.course_id) : undefined}
        files={selected ? files.filter((f) => f.deadline_id === selected.id) : []}
        now={now}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  );
}
