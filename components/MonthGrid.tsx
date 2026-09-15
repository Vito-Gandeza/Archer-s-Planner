"use client";

import { deadlineState, timeUntil, weekdayIndex, meetingsForDay, DAY_MS } from "@/lib/planner.mjs";
import type { ClassMeeting, Course, Deadline } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 4;

/**
 * Six Mondays-first weeks covering `month`, so every grid is the same shape and
 * the rows never jump around as you page through.
 */
export function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - weekdayIndex(first));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function MonthGrid({
  month,
  courses,
  deadlines,
  meetings,
  now,
  onSelect,
  onAddOn,
}: {
  month: Date;
  courses: Course[];
  deadlines: Deadline[];
  meetings: ClassMeeting[];
  now: Date;
  onSelect: (d: Deadline) => void;
  onAddOn: (day: Date) => void;
}) {
  const courseOf = new Map<string | null, Course>(courses.map((c) => [c.id, c]));
  const cells = monthCells(month);

  const byDay = new Map<string, Deadline[]>();
  for (const d of deadlines) {
    if (!d.due_at) continue;
    const key = new Date(d.due_at).toDateString();
    byDay.set(key, [...(byDay.get(key) ?? []), d]);
  }

  return (
    <div className="month">
      {WEEKDAYS.map((w) => (
        <div className="month-head" key={w}>
          {w}
        </div>
      ))}

      {cells.map((day, i) => {
        const items = (byDay.get(day.toDateString()) ?? []).sort((a, b) => a.due_at!.localeCompare(b.due_at!));
        const outside = day.getMonth() !== month.getMonth();
        const classes = (meetingsForDay(meetings, weekdayIndex(day)) as ClassMeeting[]).length;
        return (
          <div
            className="month-cell"
            key={day.toISOString()}
            data-outside={outside}
            data-today={sameDay(day, now)}
            data-weekend={weekdayIndex(day) >= 5}
            style={{ ["--i" as string]: Math.floor(i / 7) }}
          >
            <div className="month-date">
              <span className="n">{day.getDate()}</span>
              {classes > 0 && (
                <span className="cls" title={`${classes} class${classes === 1 ? "" : "es"}`}>
                  {"·".repeat(Math.min(classes, 4))}
                </span>
              )}
              <button className="addday" onClick={() => onAddOn(day)} title="Add a task on this day" aria-label="Add a task">
                +
              </button>
            </div>

            {items.slice(0, MAX_CHIPS).map((d) => (
              <button
                key={d.id}
                className="chip"
                data-state={deadlineState(d, now)}
                data-manual={d.source === "manual"}
                onClick={() => onSelect(d)}
                title={`${courseOf.get(d.course_id)?.code ?? "Task"} — ${d.title} · ${timeUntil(d.due_at!, now)}`}
              >
                <span className="c">{courseOf.get(d.course_id)?.code ?? (d.source === "manual" ? "TASK" : "—")}</span>
                <span className="t">{d.title}</span>
              </button>
            ))}
            {items.length > MAX_CHIPS && <div className="more">+{items.length - MAX_CHIPS} more</div>}
          </div>
        );
      })}
    </div>
  );
}
