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

test("hourRange pads and keeps a 4-hour floor", () => {
  assert.deepEqual(hourRange([at("2026-09-16T10:00")]), [9, 13]);
  assert.deepEqual(hourRange([]), [8, 24]);
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
