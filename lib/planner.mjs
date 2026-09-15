// Pure planner logic. Plain ESM so `node --test` can run it with no build step.

export const DAY_MS = 86400000;

/** Monday 00:00 of the week containing `d`. */
export function weekStart(d) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

/** "in 3 hr", "in 2 days", "4 hr late" — compact, matching the reference's tiny labels. */
export function timeUntil(dueAt, now = new Date()) {
  const ms = new Date(dueAt).getTime() - now.getTime();
  const late = ms < 0;
  const mins = Math.round(Math.abs(ms) / 60000);
  let value;
  if (mins < 60) value = `${mins} min`;
  else if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    value = m ? `${h} hr ${m} min` : `${h} hr`;
  } else {
    const days = Math.round(mins / (60 * 24));
    value = `${days} day${days === 1 ? "" : "s"}`;
  }
  return late ? `${value} late` : `in ${value}`;
}

/**
 * State drives the block's fill, not colour:
 *   overdue -> solid black, today -> accent, upcoming -> outlined, done -> hairline ghost.
 */
export function deadlineState(d, now = new Date()) {
  if (d.status === "submitted" || d.status === "graded" || d.status === "dismissed") return "done";
  if (!d.due_at) return "undated";
  const due = new Date(d.due_at);
  if (due.getTime() < now.getTime()) return "overdue";
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due.getTime() <= endOfToday.getTime() ? "today" : "upcoming";
}

/**
 * Pack a day's deadlines into columns so overlapping blocks sit side by side.
 * Greedy first-fit: O(n * lanes), fine for a day's worth of deadlines.
 * Returns items with { lane, lanes } plus the minute-of-day the block starts at.
 */
export function packDay(deadlines, blockMinutes = 45) {
  const items = deadlines
    .filter((d) => d.due_at)
    .map((d) => {
      const due = new Date(d.due_at);
      const start = due.getHours() * 60 + due.getMinutes();
      return { deadline: d, start, end: start + blockMinutes, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || a.deadline.title.localeCompare(b.deadline.title));

  const laneEnds = [];
  for (const it of items) {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = it.end;
    it.lane = lane;
  }
  // Blocks that share any overlap must agree on how many lanes to divide by.
  for (const it of items) {
    const overlapping = items.filter((o) => o.start < it.end && it.start < o.end);
    it.lanes = Math.max(...overlapping.map((o) => o.lane)) + 1;
  }
  return items;
}

/**
 * Hour rail bounds for the week grid. Snaps outward to whole hours and keeps a
 * floor of 4 hours so a near-empty week still looks like a grid, not a stripe.
 */
export function hourRange(deadlines, fallback = [8, 24]) {
  const hours = deadlines.filter((d) => d.due_at).map((d) => new Date(d.due_at).getHours());
  if (!hours.length) return fallback;
  let lo = Math.max(0, Math.min(...hours) - 1);
  let hi = Math.min(24, Math.max(...hours) + 2);
  while (hi - lo < 4) {
    if (hi < 24) hi++;
    else lo--;
  }
  return [lo, hi];
}

/**
 * Weighted course grade over the components that actually have a score.
 * `earned` is the weighted score so far; `graded` is the weight it covers, so
 * `earned / graded` is the running average and `earned` alone is the floor.
 */
export function courseGrade(components, grades) {
  let earned = 0;
  let gradedWeight = 0;
  let totalWeight = 0;
  for (const c of components) {
    totalWeight += Number(c.weight_percent) || 0;
    const rows = grades.filter((g) => g.component_id === c.id && g.score != null && Number(g.max_score) > 0);
    if (!rows.length) continue;
    const pts = rows.reduce((s, g) => s + Number(g.score), 0);
    const max = rows.reduce((s, g) => s + Number(g.max_score), 0);
    earned += (pts / max) * Number(c.weight_percent);
    gradedWeight += Number(c.weight_percent);
  }
  return {
    earned,
    gradedWeight,
    totalWeight,
    running: gradedWeight > 0 ? (earned / gradedWeight) * 100 : null,
  };
}

/**
 * Percentage needed on the remaining ungraded weight to land on `target`.
 * null when nothing is left to grade. Can exceed 100 (unreachable) or go
 * negative (already locked in) — the UI says so rather than clamping.
 */
export function neededOnRemaining(components, grades, target = 75) {
  const { earned, gradedWeight, totalWeight } = courseGrade(components, grades);
  const remaining = totalWeight - gradedWeight;
  if (remaining <= 0) return null;
  return ((target - earned) / remaining) * 100;
}

/**
 * Countdown split into the two largest useful units, so the hero reads
 * "2 DAYS 4 HR" rather than a wall of numbers. `late` flips the label.
 */
export function countdownParts(dueAt, now = new Date()) {
  const ms = new Date(dueAt).getTime() - now.getTime();
  const late = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const units = days > 0 ? [[days, "d"], [hours, "hr"]] : hours > 0 ? [[hours, "hr"], [minutes, "min"]] : [[minutes, "min"], [seconds, "sec"]];
  return { days, hours, minutes, seconds, late, units };
}

/**
 * Per-day counts for the seven-day density strip, split by state so the bar can
 * stack overdue/today/upcoming/done segments.
 */
export function weekPulse(deadlines, start, now = new Date(), days = 7) {
  return Array.from({ length: days }, (_, i) => {
    const from = new Date(start.getTime() + i * DAY_MS);
    const to = new Date(from.getTime() + DAY_MS);
    const items = deadlines.filter((d) => {
      if (!d.due_at) return false;
      const t = new Date(d.due_at).getTime();
      return t >= from.getTime() && t < to.getTime();
    });
    const by = { overdue: 0, today: 0, upcoming: 0, done: 0 };
    for (const d of items) by[deadlineState(d, now)] = (by[deadlineState(d, now)] ?? 0) + 1;
    return { date: from, total: items.length, by };
  });
}

/** Points at stake across a set of deadlines — the "how much does this week weigh" number. */
export function pointsAtStake(deadlines) {
  return deadlines.reduce((sum, d) => sum + (Number(d.points_possible) || 0), 0);
}
