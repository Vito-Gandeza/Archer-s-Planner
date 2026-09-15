import { test } from "node:test";
import assert from "node:assert/strict";
import {
  packDay,
  hourRange,
  courseGrade,
  neededOnRemaining,
  deadlineState,
  timeUntil,
  weekStart,
  countdownParts,
  weekPulse,
  pointsAtStake,
  toMinutes,
  formatTime,
  weekdayIndex,
  meetingsForDay,
  classNow,
  dayLoadMinutes,
  packDayWithClasses,
  shortCode,
  triage,
  isStale,
} from "./planner.mjs";

const at = (iso, extra = {}) => ({ title: iso, due_at: iso, status: "open", ...extra });

test("weekStart snaps to Monday midnight", () => {
  assert.equal(weekStart(new Date("2026-09-16T13:00:00")).getDay(), 1); // Wed -> Mon
  assert.equal(weekStart(new Date("2026-09-14T00:30:00")).getDate(), 14); // Mon stays
});

test("overlapping deadlines get separate lanes, disjoint ones reuse lane 0", () => {
  const packed = packDay([at("2026-09-16T23:59"), at("2026-09-16T23:30"), at("2026-09-16T09:00")]);
  const nine = packed.find((p) => p.start === 540);
  assert.equal(nine.lane, 0);
  assert.equal(nine.lanes, 1);
  const late = packed.filter((p) => p.start > 1000);
  assert.deepEqual(late.map((p) => p.lane).sort(), [0, 1]);
  assert.ok(late.every((p) => p.lanes === 2));
});

test("hourRange always covers the teaching day, then expands for content", () => {
  // Nothing at all still draws a real day, not a stripe.
  assert.deepEqual(hourRange([]), [8, 18]);
  // A mid-morning deadline sits inside the day window, which is left alone.
  assert.deepEqual(hourRange([at("2026-09-16T10:00")]), [8, 18]);
  // Late-night deadlines extend the bottom instead of collapsing the grid onto them.
  assert.deepEqual(hourRange([at("2026-09-16T23:59")]), [8, 24]);
  // An early class extends the top.
  assert.deepEqual(hourRange([at("2026-09-16T07:00")]), [6, 18]);
});

test("grade math weights by component, not by raw points", () => {
  const components = [
    { id: "a", weight_percent: 30 },
    { id: "b", weight_percent: 70 },
  ];
  const grades = [{ component_id: "a", score: 45, max_score: 50 }];
  const g = courseGrade(components, grades);
  assert.equal(g.earned, 27); // 90% of 30
  assert.equal(g.gradedWeight, 30);
  assert.equal(g.running, 90);
  // Need (75 - 27) / 70 = 68.57% on what is left.
  assert.ok(Math.abs(neededOnRemaining(components, grades, 75) - 68.571) < 0.01);
  assert.equal(neededOnRemaining(components, [...grades, { component_id: "b", score: 70, max_score: 70 }]), null);
});

test("state and label flip around now", () => {
  const now = new Date("2026-09-16T12:00:00");
  assert.equal(deadlineState(at("2026-09-16T23:59:00"), now), "today");
  assert.equal(deadlineState(at("2026-09-15T23:59:00"), now), "overdue");
  assert.equal(deadlineState(at("2026-09-20T23:59:00"), now), "upcoming");
  assert.equal(deadlineState(at("2026-09-20T23:59:00", { status: "graded" }), now), "done");
  assert.equal(timeUntil("2026-09-16T15:00:00", now), "in 3 hr");
  assert.equal(timeUntil("2026-09-16T11:00:00", now), "1 hr late");
});

test("countdown picks the two largest useful units", () => {
  const now = new Date("2026-09-16T12:00:00");
  assert.deepEqual(countdownParts("2026-09-18T16:00:00", now).units, [[2, "d"], [4, "hr"]]);
  assert.deepEqual(countdownParts("2026-09-16T14:30:00", now).units, [[2, "hr"], [30, "min"]]);
  assert.deepEqual(countdownParts("2026-09-16T12:05:30", now).units, [[5, "min"], [30, "sec"]]);
  assert.equal(countdownParts("2026-09-16T11:00:00", now).late, true);
});

test("weekPulse buckets by day and by state", () => {
  const now = new Date("2026-09-16T12:00:00");
  const start = weekStart(now);
  const pulse = weekPulse(
    [at("2026-09-16T23:59:00"), at("2026-09-16T09:00:00"), at("2026-09-18T10:00:00")],
    start,
    now,
  );
  assert.equal(pulse.length, 7);
  assert.equal(pulse[2].total, 2); // Wednesday
  assert.equal(pulse[2].by.today, 1);
  assert.equal(pulse[2].by.overdue, 1);
  assert.equal(pulse[4].by.upcoming, 1); // Friday
  assert.equal(pulse[0].total, 0);
});

test("pointsAtStake sums what is gradeable", () => {
  assert.equal(pointsAtStake([{ points_possible: 100 }, { points_possible: null }, { points_possible: 40 }]), 140);
});

const meet = (weekday, starts_at, ends_at, extra = {}) => ({ weekday, starts_at, ends_at, ...extra });

test("class schedule helpers read a weekday grid", () => {
  assert.equal(toMinutes("09:15:00"), 555);
  assert.equal(formatTime("13:05:00"), "1:05 PM");
  assert.equal(formatTime("00:30:00"), "12:30 AM");
  assert.equal(weekdayIndex(new Date("2026-09-14T08:00:00")), 0); // Monday
  assert.equal(weekdayIndex(new Date("2026-09-20T08:00:00")), 6); // Sunday

  const meetings = [meet(0, "11:00:00", "14:00:00"), meet(0, "09:15:00", "10:45:00"), meet(2, "09:15:00", "10:45:00")];
  assert.deepEqual(
    meetingsForDay(meetings, 0).map((m) => m.starts_at),
    ["09:15:00", "11:00:00"],
  );
  assert.equal(dayLoadMinutes(meetings, 0), 90 + 180);
  assert.equal(dayLoadMinutes(meetings, 1), 0);
});

test("classNow separates the class you are in from the one coming up", () => {
  const meetings = [meet(0, "09:15:00", "10:45:00"), meet(0, "11:00:00", "14:00:00")];
  const during = classNow(meetings, new Date("2026-09-14T09:30:00"));
  assert.equal(during.current.starts_at, "09:15:00");
  assert.equal(during.next.starts_at, "11:00:00");

  const gap = classNow(meetings, new Date("2026-09-14T10:50:00"));
  assert.equal(gap.current, null);
  assert.equal(gap.next.starts_at, "11:00:00");

  const after = classNow(meetings, new Date("2026-09-14T20:00:00"));
  assert.equal(after.current, null);
  assert.equal(after.next, null);
  assert.equal(classNow(meetings, new Date("2026-09-15T09:30:00")).today.length, 0); // Tuesday
});

test("packDayWithClasses lanes classes and deadlines together", () => {
  const meetings = [meet(0, "11:00:00", "14:00:00")];
  const deadlines = [at("2026-09-14T11:59:00"), at("2026-09-14T09:00:00")];
  const packed = packDayWithClasses(deadlines, meetings);
  assert.equal(packed.length, 3);

  const cls = packed.find((p) => p.kind === "class");
  assert.equal(cls.start, 660);
  assert.equal(cls.end, 840); // real duration, not a nominal block

  // 9am deadline is clear of the class, so it keeps lane 0 on its own.
  const morning = packed.find((p) => p.kind === "deadline" && p.start === 540);
  assert.equal(morning.lanes, 1);

  // The 11:59 deadline overlaps the class, so both split the column.
  const clash = packed.find((p) => p.kind === "deadline" && p.start === 719);
  assert.equal(clash.lanes, 2);
  assert.notEqual(clash.lane, cls.lane);
});

test("hourRange makes room for class meetings, not just deadlines", () => {
  // Inside the teaching day, the window is unchanged.
  assert.deepEqual(hourRange([], undefined, [meet(0, "09:15:00", "10:45:00")]), [8, 18]);
  // An evening class pushes the bottom out; ending exactly on the hour must not
  // pull in an extra empty hour beyond that.
  assert.deepEqual(hourRange([], undefined, [meet(0, "18:00:00", "21:00:00")]), [8, 22]);
});

test("shortCode strips the section Canvas glues onto a course code", () => {
  assert.equal(shortCode("MICPROS_E25"), "MICPROS");
  assert.equal(shortCode("NSTP101 - EA4"), "NSTP101");
  assert.equal(shortCode("LIBRES-General AY 2026-2027"), "LIBRES");
  assert.equal(shortCode("AnimoSpace 101"), "AnimoSpace");
  assert.equal(shortCode("ECNOMIC_ER1"), "ECNOMIC");
  // Nothing usable falls through to the fallback, then to an empty string.
  assert.equal(shortCode("", "146985"), "146985");
  assert.equal(shortCode(null, null), "");
});

test("triage keeps months-old leftovers out of the urgent pile", () => {
  const now = new Date("2026-09-16T12:00:00");
  const ancient = at("2025-01-17T17:00:00"); // 600-ish days late
  const recent = at("2026-09-14T11:00:00"); // 2 days late
  const soon = at("2026-09-18T23:59:00");
  const t = triage([ancient, recent, soon, at("2026-09-20T10:00", { status: "graded" })], now);

  assert.equal(t.stale.length, 1);
  assert.equal(t.stale[0].due_at, ancient.due_at);
  assert.equal(t.overdue.length, 1);
  assert.equal(t.overdue[0].due_at, recent.due_at);
  assert.ok(!t.overdue.includes(ancient), "an ancient item must never rank as urgent");

  assert.equal(isStale(recent, now), false);
  assert.equal(isStale(ancient, now), true);
  assert.equal(isStale({ due_at: null }, now), false);
});
