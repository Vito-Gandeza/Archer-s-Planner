"use client";

import { useEffect, useMemo, useState } from "react";
import { Masthead } from "@/components/Chrome";
import WeekGrid from "@/components/WeekGrid";
import DeadlineDialog from "@/components/DeadlineDialog";
import { useSnapshot } from "@/lib/useSnapshot";
import { weekStart, deadlineState, DAY_MS } from "@/lib/planner.mjs";
import type { Deadline } from "@/lib/types";

export default function TimelinePage() {
  const { snapshot, stale, refresh } = useSnapshot();
  const [offset, setOffset] = useState(0);
  const [days, setDays] = useState(7);
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
          {inWeek.length} deadline{inWeek.length === 1 ? "" : "s"} in view
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
          <button onClick={() => setDays((d) => (d === 7 ? 5 : 7))}>{days === 7 ? "7 days" : "5 days"}</button>
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

      {deadlines.length === 0 ? (
        <div className="hatchbox" style={{ padding: "64px 24px" }}>
          Nothing synced yet
          <small>Set up the extension from Settings, then open AnimoSpace.</small>
        </div>
      ) : (
        <WeekGrid
          weekStart={start}
          days={days}
          courses={courses}
          deadlines={deadlines}
          files={files}
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
