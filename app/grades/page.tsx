"use client";

import { useMemo, useState } from "react";
import { Masthead } from "@/components/Chrome";
import { useSnapshot } from "@/lib/useSnapshot";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { courseGrade, neededOnRemaining } from "@/lib/planner.mjs";
import type { GradeComponent } from "@/lib/types";

const TARGETS = [95, 90, 85, 80, 75];

export default function GradesPage() {
  const { visible: snapshot, stale, refresh } = useSnapshot();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [target, setTarget] = useState(85);
  const [busy, setBusy] = useState(false);

  const courses = snapshot?.courses ?? [];
  const active = courseId ?? courses[0]?.id ?? null;
  const components = useMemo(
    () => (snapshot?.components ?? []).filter((c) => c.course_id === active),
    [snapshot, active],
  );
  const grades = useMemo(() => (snapshot?.grades ?? []).filter((g) => g.course_id === active), [snapshot, active]);

  const summary = courseGrade(components, grades) as {
    earned: number;
    gradedWeight: number;
    totalWeight: number;
    running: number | null;
  };
  const needed = neededOnRemaining(components, grades, target) as number | null;

  async function saveScore(component: GradeComponent, score: string, max: string) {
    if (!active) return;
    setBusy(true);
    const existing = grades.find((g) => g.component_id === component.id);
    const row = {
      user_id: undefined as unknown as string, // filled by the default below
      course_id: active,
      component_id: component.id,
      label: component.label,
      score: score === "" ? null : Number(score),
      max_score: max === "" ? null : Number(max),
      source: "manual" as const,
    };
    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    row.user_id = auth.user!.id;
    if (existing) await sb.from("grades").update(row).eq("id", existing.id);
    else await sb.from("grades").insert(row);
    setBusy(false);
    refresh();
  }

  async function addComponent() {
    if (!active) return;
    const sb = supabaseBrowser();
    const { data: auth } = await sb.auth.getUser();
    await sb
      .from("grade_components")
      .insert({ user_id: auth.user!.id, course_id: active, label: "New component", weight_percent: 0, source: "manual" });
    refresh();
  }

  async function patchComponent(id: string, patch: Partial<GradeComponent>) {
    await supabaseBrowser().from("grade_components").update(patch).eq("id", id);
    refresh();
  }

  async function removeComponent(id: string) {
    await supabaseBrowser().from("grade_components").delete().eq("id", id);
    refresh();
  }

  const weightSum = components.reduce((s, c) => s + Number(c.weight_percent), 0);

  return (
    <div className="shell">
      <Masthead title="Grades" onSynced={refresh}>
        <p className="dek">
          Weighted from the syllabus breakdown{stale && " · offline copy"}
        </p>
      </Masthead>

      <div className="weekbar">
        <div className="nav">
          {courses.map((c) => (
            <button key={c.id} data-active={c.id === active} onClick={() => setCourseId(c.id)}>
              {c.code}
            </button>
          ))}
        </div>
        <div className="nav">
          {TARGETS.map((t) => (
            <button key={t} data-active={t === target} onClick={() => setTarget(t)}>
              Target {t}
            </button>
          ))}
        </div>
      </div>

      {!active ? (
        <p className="empty-state">No courses synced yet.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 48, alignItems: "flex-end", flexWrap: "wrap", margin: "8px 0 26px" }}>
            <div>
              <div className="sectionhead" style={{ margin: 0 }}>
                Running
              </div>
              <div className="bigfig">{summary.running == null ? "—" : `${summary.running.toFixed(1)}%`}</div>
              <p className="stat">
                <b>{summary.gradedWeight}%</b> of the grade is in
              </p>
            </div>
            <div>
              <div className="sectionhead" style={{ margin: 0 }}>
                Locked in
              </div>
              <div className="bigfig">{summary.earned.toFixed(1)}</div>
              <p className="stat">points of 100 already earned</p>
            </div>
            <div>
              <div className="sectionhead" style={{ margin: 0 }}>
                To hit {target}
              </div>
              <div className="bigfig" style={{ color: needed != null && needed > 100 ? "var(--accent)" : undefined }}>
                {needed == null ? "—" : `${needed.toFixed(1)}%`}
              </div>
              <p className="stat">
                {needed == null
                  ? "everything is graded"
                  : needed > 100
                    ? "not reachable on what is left"
                    : needed <= 0
                      ? "already secured"
                      : `average needed on the remaining ${(summary.totalWeight - summary.gradedWeight).toFixed(0)}%`}
              </p>
            </div>
          </div>

          <table className="sheet">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Weight</th>
                <th className="num">Score</th>
                <th className="num">Out of</th>
                <th className="num">Contributes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {components.map((c) => {
                const g = grades.find((x) => x.component_id === c.id);
                const pct = g?.score != null && Number(g.max_score) > 0 ? Number(g.score) / Number(g.max_score) : null;
                return (
                  <tr key={c.id}>
                    <td>
                      <input
                        className="field"
                        defaultValue={c.label}
                        onBlur={(e) => e.target.value !== c.label && patchComponent(c.id, { label: e.target.value })}
                      />
                      {c.source === "ai_extracted" && <span className="stat"> extracted from syllabus</span>}
                    </td>
                    <td className="num">
                      <input
                        className="cell"
                        type="number"
                        defaultValue={c.weight_percent}
                        onBlur={(e) =>
                          Number(e.target.value) !== Number(c.weight_percent) &&
                          patchComponent(c.id, { weight_percent: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="num">
                      <input
                        className="cell"
                        type="number"
                        step="any"
                        defaultValue={g?.score ?? ""}
                        onBlur={(e) => saveScore(c, e.target.value, String(g?.max_score ?? 100))}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="cell"
                        type="number"
                        step="any"
                        defaultValue={g?.max_score ?? ""}
                        onBlur={(e) => saveScore(c, String(g?.score ?? ""), e.target.value)}
                      />
                    </td>
                    <td className="num">
                      <b>{pct == null ? "—" : (pct * Number(c.weight_percent)).toFixed(1)}</b>
                    </td>
                    <td className="num">
                      <button className="btn btn-ghost" onClick={() => removeComponent(c.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="nav" style={{ marginTop: 14 }}>
            <button className="btn" onClick={addComponent} disabled={busy}>
              Add component
            </button>
            <span className="stat" style={{ marginLeft: 12, alignSelf: "center" }}>
              Weights total <b>{weightSum}%</b>
              {weightSum !== 100 && " — syllabus breakdowns usually add to 100"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
