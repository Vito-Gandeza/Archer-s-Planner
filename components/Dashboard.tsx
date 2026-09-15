"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Masthead, PanelHead } from "./Chrome";
import DeadlineDialog, { Clock } from "./DeadlineDialog";
import { useSnapshot } from "@/lib/useSnapshot";
import { CANVAS_ORIGIN } from "@/lib/config";
import { supabaseBrowser } from "@/lib/supabase-browser";
import {
  countdownParts,
  courseGrade,
  deadlineState,
  pointsAtStake,
  timeUntil,
  weekPulse,
  weekStart,
  DAY_MS,
} from "@/lib/planner.mjs";
import type { Course, Deadline, PlannerSnapshot } from "@/lib/types";


/** Owns its own ticking state so a live second-hand never re-renders the page. */
function Countdown({ dueAt }: { dueAt: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { units, late } = countdownParts(dueAt, now) as unknown as {
    units: [number, string][];
    late: boolean;
  };
  return (
    <div className="countdown">
      <div className="big">
        {units.map(([value, unit]) => (
          <span key={unit}>
            {value}
            <u>{unit}</u>
          </span>
        ))}
      </div>
      <div className="label">{late ? "overdue" : "remaining"}</div>
    </div>
  );
}

/**
 * `fixture` is for the /preview design harness only: it renders the real
 * dashboard against sample data without touching Supabase or the offline
 * cache, so previewing can never leave fake courses behind for the real app
 * to read back.
 */
export default function Dashboard({ fixture }: { fixture?: PlannerSnapshot }) {
  const live = useSnapshot();
  const snapshot = fixture ?? live.snapshot;
  const stale = fixture ? false : live.stale;
  const error = fixture ? null : live.error;
  const loading = fixture ? false : live.loading;
  const refresh = fixture ? () => {} : live.refresh;
  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<Deadline | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const courses = useMemo(() => snapshot?.courses ?? [], [snapshot]);
  const deadlines = useMemo(() => snapshot?.deadlines ?? [], [snapshot]);
  const files = snapshot?.files ?? [];
  const components = snapshot?.components ?? [];
  const grades = snapshot?.grades ?? [];
  const courseOf = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const open = deadlines.filter((d) => d.status === "open");
  const dated = open.filter((d) => d.due_at);
  const overdue = dated.filter((d) => deadlineState(d, now) === "overdue");
  const dueToday = dated.filter((d) => deadlineState(d, now) === "today");
  const horizon = new Date(now.getTime() + 7 * DAY_MS);
  const nextSeven = dated
    .filter((d) => new Date(d.due_at!) >= now && new Date(d.due_at!) <= horizon)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!));

  // Overdue first — the thing you are most likely to have forgotten.
  const queue = [...overdue.sort((a, b) => b.due_at!.localeCompare(a.due_at!)), ...nextSeven];
  const hero = queue[0] ?? null;
  const rest = queue.slice(1, 9);
  const undated = open.filter((d) => !d.due_at);

  const pulse = weekPulse(deadlines, weekStart(now), now) as {
    date: Date;
    total: number;
    by: Record<string, number>;
  }[];
  const pulseMax = Math.max(1, ...pulse.map((p) => p.total));

  const standings = courses
    .map((c) => {
      const cs = components.filter((x) => x.course_id === c.id);
      const gs = grades.filter((x) => x.course_id === c.id);
      return { course: c, cs, ...(courseGrade(cs, gs) as { running: number | null; gradedWeight: number; totalWeight: number }) };
    })
    .sort((a, b) => (b.running ?? -1) - (a.running ?? -1));

  const recentFiles = [...files].slice(-7).reverse();

  async function toggleDone(d: Deadline) {
    await supabaseBrowser().from("deadlines").update({ status: "submitted" }).eq("id", d.id);
    refresh();
  }

  return (
    <div className="shell">
      <Masthead title="Archer's Planner" onSynced={refresh}>
        <p className="dek">
          {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          {" · "}
          {courses.length} course{courses.length === 1 ? "" : "s"}
          {" · "}
          {stale ? "offline copy" : loading ? "syncing…" : "up to date"}
        </p>
      </Masthead>

      {error && <p className="err" style={{ marginTop: 16 }}>{error}</p>}

      <section className="stats">
        <Stat i={0} k="Due today" v={dueToday.length} sub={dueToday.length ? "finish these" : "nothing today"} accent={dueToday.length > 0} />
        <Stat i={1} k="Overdue" v={overdue.length} sub={overdue.length ? "still open" : "all clear"} />
        <Stat i={2} k="Next 7 days" v={nextSeven.length} sub={`${undated.length} with no date`} />
        <Stat i={3} k="Points at stake" v={Math.round(pointsAtStake(nextSeven))} sub="this week's deadlines" />
      </section>

      {!snapshot && loading ? (
        <p className="empty-state">Loading…</p>
      ) : deadlines.length === 0 ? (
        <EmptyFirstRun />
      ) : (
        <div className="deck">
          <div>
            <section className="panel rise" style={{ ["--i" as string]: 2 }}>
              <PanelHead title="Next up" count={hero ? timeUntil(hero.due_at!, now) : undefined} />
              {hero ? (
                <div
                  className="hero"
                  data-state={deadlineState(hero, now)}
                  style={{ marginTop: 16, cursor: "pointer" }}
                  onClick={() => setSelected(hero)}
                >
                  <div>
                    <div className="eyebrow">
                      {courseOf.get(hero.course_id)?.name ?? "Course"} · {hero.type}
                    </div>
                    <h3 className="code">{courseOf.get(hero.course_id)?.code ?? "—"}</h3>
                    <p className="task">{hero.title}</p>
                    <p className="meta">
                      Due{" "}
                      {new Date(hero.due_at!).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })},{" "}
                      <Clock date={new Date(hero.due_at!)} />
                      {hero.points_possible != null && ` · ${hero.points_possible} pts`}
                      {files.filter((f) => f.deadline_id === hero.id).length > 0 &&
                        ` · ${files.filter((f) => f.deadline_id === hero.id).length} file(s)`}
                    </p>
                  </div>
                  <Countdown dueAt={hero.due_at!} />
                </div>
              ) : (
                <div className="hatchbox" style={{ marginTop: 16 }}>
                  Nothing due in the next seven days
                  <small>Enjoy it, or get ahead on something further out.</small>
                </div>
              )}
            </section>

            <section className="panel rise" style={{ ["--i" as string]: 3 }}>
              <PanelHead title="Queue" count={`${rest.length} of ${queue.length}`} />
              {rest.length ? (
                <div className="tasks">
                  {rest.map((d, i) => (
                    <TaskRow
                      key={d.id}
                      d={d}
                      course={courseOf.get(d.course_id)}
                      now={now}
                      i={i}
                      onOpen={() => setSelected(d)}
                      onTick={() => toggleDone(d)}
                    />
                  ))}
                </div>
              ) : (
                <div className="hatchbox">Queue is clear</div>
              )}
            </section>

            {undated.length > 0 && (
              <section className="panel rise" style={{ ["--i" as string]: 4 }}>
                <PanelHead title="No due date" count={undated.length} />
                <div className="tasks">
                  {undated.slice(0, 6).map((d, i) => (
                    <TaskRow
                      key={d.id}
                      d={d}
                      course={courseOf.get(d.course_id)}
                      now={now}
                      i={i}
                      onOpen={() => setSelected(d)}
                      onTick={() => toggleDone(d)}
                    />
                  ))}
                </div>
              </section>
            )}

            <section className="panel rise" style={{ ["--i" as string]: 5 }}>
              <PanelHead
                title="This week"
                count={
                  <Link href="/timeline" style={{ textDecoration: "underline" }}>
                    Open timeline
                  </Link>
                }
              />
              <div className="pulse">
                {pulse.map((p, i) => (
                  <button
                    key={p.date.toISOString()}
                    className="pulse-day"
                    data-today={p.date.toDateString() === now.toDateString()}
                    onClick={() => (window.location.href = "/timeline")}
                  >
                    <div className="d">{p.date.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div className="pulse-bar">
                      {(["done", "upcoming", "today", "overdue"] as const).map((state) =>
                        p.by[state] ? (
                          <i
                            key={state}
                            data-state={state}
                            style={{
                              height: `${(p.by[state] / pulseMax) * 100}%`,
                              ["--i" as string]: i,
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                    <div className="n" data-zero={p.total === 0}>
                      {p.total}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside>
            <section className="panel rise" style={{ ["--i" as string]: 3 }}>
              <PanelHead
                title="Standing"
                count={
                  <Link href="/grades" style={{ textDecoration: "underline" }}>
                    Edit
                  </Link>
                }
              />
              {standings.length ? (
                standings.map((s, i) => (
                  <div className="meter-row" key={s.course.id}>
                    <div className="meter-top">
                      <span className="code">{s.course.code}</span>
                      <span className="val" data-empty={s.running == null}>
                        {s.running == null ? "—" : `${s.running.toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="meter">
                      <i style={{ ["--w" as string]: `${Math.min(100, s.running ?? 0)}%`, ["--i" as string]: i }} />
                    </div>
                    <div className="meter-foot">
                      <span>
                        {s.cs.length ? `${s.gradedWeight}% of ${s.totalWeight}% graded` : "no breakdown yet"}
                      </span>
                      <span>{s.course.instructor ?? ""}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="hatchbox">No courses yet</div>
              )}
            </section>

            <section className="panel rise" style={{ ["--i" as string]: 4 }}>
              <PanelHead title="Recent files" count={files.length} />
              {recentFiles.length ? (
                <div className="mini">
                  {recentFiles.map((f) => (
                    <a key={f.id} className="mini-row" href={f.canvas_url ?? "#"} target="_blank" rel="noreferrer">
                      <span className="nm">{f.filename}</span>
                      <span className="tag">{courseOf.get(f.course_id)?.code ?? ""}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="hatchbox">
                  No files synced
                  <small>They arrive with the next Canvas sync.</small>
                </div>
              )}
            </section>
          </aside>
        </div>
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

function Stat({ i, k, v, sub, accent }: { i: number; k: string; v: number; sub: string; accent?: boolean }) {
  return (
    <div className="stat-cell rise" data-accent={!!accent} style={{ ["--i" as string]: i }}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function TaskRow({
  d,
  course,
  now,
  i,
  onOpen,
  onTick,
}: {
  d: Deadline;
  course?: Course;
  now: Date;
  i: number;
  onOpen: () => void;
  onTick: () => void;
}) {
  const state = deadlineState(d, now) as string;
  return (
    <div className="task-row fade" data-state={state} style={{ ["--i" as string]: i }} onClick={onOpen}>
      <button
        className="tick"
        data-on={d.status !== "open"}
        aria-label={d.status === "open" ? "Mark done" : "Done"}
        onClick={(e) => {
          e.stopPropagation();
          onTick();
        }}
      />
      <span className="code">
        {course?.code ?? "—"}
        <span className="kind">{d.type}</span>
      </span>
      <span className="name">{d.title}</span>
      <span className="when">
        {d.due_at ? (
          <>
            {new Date(d.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
            <Clock date={new Date(d.due_at)} />
          </>
        ) : (
          "—"
        )}
      </span>
      <span className="left">{d.due_at ? timeUntil(d.due_at, now) : `${d.points_possible ?? 0} pts`}</span>
    </div>
  );
}

function EmptyFirstRun() {
  return (
    <div className="deck">
      <section className="panel rise" style={{ ["--i" as string]: 2 }}>
        <PanelHead title="Nothing synced yet" />
        <div className="hatchbox" style={{ padding: "48px 24px" }}>
          Your Canvas data has not arrived
          <small>Three steps and it fills itself in.</small>
        </div>
        <ol className="note" style={{ paddingLeft: 18, marginTop: 18, lineHeight: 1.9 }}>
          <li>
            <Link href="/settings" style={{ textDecoration: "underline" }}>
              Settings
            </Link>{" "}
            → generate a sync token.
          </li>
          <li>
            Load the <span className="mono">extension/</span> folder unpacked in Chrome or Brave, paste the token.
          </li>
          <li>
            Open{" "}
            <a href={CANVAS_ORIGIN} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              AnimoSpace
            </a>{" "}
            — it syncs on load.
          </li>
        </ol>
      </section>
    </div>
  );
}
