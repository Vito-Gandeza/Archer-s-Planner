"use client";

import { hourRange, deadlineState, timeUntil, packDayWithClasses, formatTime, toMinutes, DAY_MS } from "@/lib/planner.mjs";
import { Clock } from "./DeadlineDialog";
import type { ClassMeeting, Course, CourseFile, Deadline } from "@/lib/types";

/**
 * The grid is sized to fit, not to a fixed scale. A week whose deadlines all
 * land at 11:59pm spans 8am to midnight; at a fixed 64px an hour that is over
 * 1000px of mostly empty hatching, which pushes everything under the grid off
 * the screen. Total height is held near TARGET_BODY_PX instead, with a floor
 * that keeps the hour labels legible.
 */
const TARGET_BODY_PX = 620;
const MIN_HOUR_PX = 38;
const MAX_HOUR_PX = 64;
const BLOCK_MINUTES = 45;

const clamp = (min: number, value: number, max: number) => Math.max(min, Math.min(value, max));

function HourTick({ hour, top }: { hour: number; top: number }) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mer = hour === 24 ? "AM" : hour === 12 ? "NN" : hour < 12 ? "AM" : "PM";
  return (
    <div className="tick-label" style={{ top }}>
      {h12}
      <span className="mer">{mer}</span>
    </div>
  );
}

type Props = {
  weekStart: Date;
  days: number;
  courses: Course[];
  deadlines: Deadline[];
  files: CourseFile[];
  meetings: ClassMeeting[];
  now: Date;
  onSelect: (d: Deadline) => void;
};

type Packed = {
  kind: "class" | "deadline";
  deadline?: Deadline;
  meeting?: ClassMeeting;
  start: number;
  end: number;
  lane: number;
  lanes: number;
};

export default function WeekGrid({ weekStart, days, courses, deadlines, files, meetings, now, onSelect }: Props) {
  const end = new Date(weekStart.getTime() + days * DAY_MS);
  const inWeek = deadlines.filter((d) => {
    if (!d.due_at) return false;
    const t = new Date(d.due_at).getTime();
    return t >= weekStart.getTime() && t < end.getTime();
  });

  const [lo, hi] = hourRange(inWeek, undefined, meetings) as [number, number];
  const hourPx = clamp(MIN_HOUR_PX, TARGET_BODY_PX / (hi - lo), MAX_HOUR_PX);
  // A deadline is an instant, so its block is sized off the row height rather
  // than off a duration — but never so tall it swallows the hour after it.
  const deadlinePx = clamp(50, hourPx * 1.35, 92);
  const bodyHeight = (hi - lo) * hourPx;
  const courseOf = new Map(courses.map((c) => [c.id, c]));
  const fileCount = new Map<string, number>();
  for (const f of files) if (f.deadline_id) fileCount.set(f.deadline_id, (fileCount.get(f.deadline_id) ?? 0) + 1);

  const ticks = [];
  for (let h = lo; h <= hi; h++) ticks.push(h);

  const columns = Array.from({ length: days }, (_, i) => {
    const dayDate = new Date(weekStart.getTime() + i * DAY_MS);
    const dayEnd = new Date(dayDate.getTime() + DAY_MS);
    const forDay = inWeek.filter((d) => {
      const t = new Date(d.due_at!).getTime();
      return t >= dayDate.getTime() && t < dayEnd.getTime();
    });
    const dayMeetings = meetings.filter((m) => m.weekday === i);
    return { dayDate, packed: packDayWithClasses(forDay, dayMeetings, BLOCK_MINUTES) as Packed[] };
  });

  const nowTop =
    now.getHours() + now.getMinutes() / 60 >= lo && now.getHours() < hi
      ? (now.getHours() + now.getMinutes() / 60 - lo) * hourPx
      : null;

  return (
    <div className="scroller">
      <div className="grid" style={{ ["--days" as string]: days, ["--hour" as string]: `${hourPx}px` }}>
        <div />
        {columns.map(({ dayDate }) => (
          <div className="dayhead" key={`h${dayDate.toISOString()}`} data-today={sameDay(dayDate, now)}>
            <div className="name">{dayDate.toLocaleDateString(undefined, { weekday: "long" })}</div>
            <div className="date">
              {String(dayDate.getDate()).padStart(2, "0")}/{String(dayDate.getMonth() + 1).padStart(2, "0")}
            </div>
          </div>
        ))}
        <div />

        <div className="rail" style={{ height: bodyHeight }}>
          {ticks.map((h) => (
            <HourTick key={h} hour={h} top={(h - lo) * hourPx} />
          ))}
        </div>

        {columns.map(({ dayDate, packed }) => (
          <div className="col" key={dayDate.toISOString()} style={{ height: bodyHeight }}>
            {packed.length === 0 && (
              <div className="emptylabel">
                nothing due
                <small>{dayDate.toLocaleDateString(undefined, { weekday: "long" })}</small>
              </div>
            )}
            {nowTop !== null && sameDay(dayDate, now) && <div className="nowline" style={{ top: nowTop }} />}

            {packed.map((item, bi) => {
              const width = 100 / item.lanes;
              const rawTop = (item.start - lo * 60) * (hourPx / 60);
              // A class keeps its real duration; a deadline is an instant, so it
              // gets a fixed block tall enough to hold its own label.
              const height =
                item.kind === "class"
                  ? Math.max(34, (item.end - item.start) * (hourPx / 60))
                  : deadlinePx;
              const top = Math.max(0, Math.min(rawTop, bodyHeight - height));
              const common = {
                style: {
                  top,
                  height,
                  left: `calc(${item.lane * width}% + ${item.lane ? 2 : 0}px)`,
                  width: `calc(${width}% - ${item.lanes > 1 ? 2 : 0}px)`,
                } as React.CSSProperties,
                "data-narrow": item.lanes > 1,
                "data-short": height < 52,
                "data-compact": height >= 52 && height < 78,
              };

              if (item.kind === "class" && item.meeting) {
                const m = item.meeting;
                const course = courseOf.get(m.course_id);
                return (
                  <div
                    key={`m${m.id}-${bi}`}
                    className="block class"
                    data-mode={m.mode}
                    title={`${course?.code ?? ""} ${formatTime(m.starts_at)}–${formatTime(m.ends_at)}${m.room ? ` · ${m.room}` : ""}`}
                    {...common}
                  >
                    <div className="topline">
                      <span className="time">
                        {formatTime(m.starts_at)} — {formatTime(m.ends_at)}
                      </span>
                      <span className="until">{Math.round((toMinutes(m.ends_at) - toMinutes(m.starts_at)) / 6) / 10} hr</span>
                    </div>
                    <div className="code">{course?.code ?? "—"}</div>
                    <div className="title">{course?.name ?? ""}</div>
                    <div className="foot">
                      {m.room && <span className="kind">{m.room}</span>}
                      <span className="files">{course?.instructor ?? m.mode}</span>
                    </div>
                  </div>
                );
              }

              const d = item.deadline!;
              const due = new Date(d.due_at!);
              const state = deadlineState(d, now) as string;
              const course = courseOf.get(d.course_id);
              const nFiles = fileCount.get(d.id) ?? 0;
              return (
                <button
                  key={d.id}
                  className="block"
                  data-state={state}
                  title={`${course?.code ?? ""} — ${d.title}`}
                  onClick={() => onSelect(d)}
                  {...common}
                >
                  <div className="topline">
                    <span className="time">
                      <Clock date={due} />
                    </span>
                    <span className="until">{timeUntil(d.due_at!, now)}</span>
                  </div>
                  <div className="code">{course?.code ?? "—"}</div>
                  <div className="title">{d.title}</div>
                  <div className="foot">
                    <span className="kind">{d.type}</span>
                    {nFiles > 0 && (
                      <span className="files">
                        {nFiles} file{nFiles === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        <div className="rail right" style={{ height: bodyHeight }}>
          {ticks.map((h) => (
            <HourTick key={h} hour={h} top={(h - lo) * hourPx} />
          ))}
        </div>
      </div>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
