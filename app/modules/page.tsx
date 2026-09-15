"use client";

import { useMemo, useState } from "react";
import { Masthead, PanelHead } from "@/components/Chrome";
import { useSnapshot } from "@/lib/useSnapshot";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { deadlineState } from "@/lib/planner.mjs";
import type { ModuleItem } from "@/lib/types";

/** Canvas item types, shortened for the narrow type column. */
const TYPE_LABEL: Record<string, string> = {
  File: "file",
  Page: "page",
  Assignment: "task",
  Quiz: "quiz",
  Discussion: "forum",
  ExternalUrl: "link",
  ExternalTool: "tool",
};

export default function ModulesPage() {
  const { snapshot, stale, refresh } = useSnapshot();
  const [courseId, setCourseId] = useState<string | null>(null);
  const [filesOnly, setFilesOnly] = useState(false);

  const courses = snapshot?.courses ?? [];
  const modules = snapshot?.modules ?? [];
  const items = snapshot?.moduleItems ?? [];
  const deadlines = snapshot?.deadlines ?? [];
  const now = new Date();

  const active = courseId ?? courses.find((c) => modules.some((m) => m.course_id === c.id))?.id ?? courses[0]?.id ?? null;
  const courseModules = useMemo(
    () => modules.filter((m) => m.course_id === active).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [modules, active],
  );

  // Only open deadlines are worth offering as link targets.
  const linkTargets = useMemo(
    () =>
      deadlines
        .filter((d) => d.course_id === active && d.status === "open")
        .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? "")),
    [deadlines, active],
  );

  async function link(item: ModuleItem, deadlineId: string) {
    await supabaseBrowser()
      .from("module_items")
      .update({ deadline_id: deadlineId || null })
      .eq("id", item.id);
    refresh();
  }

  const linkedCount = items.filter((i) => i.course_id === active && i.deadline_id).length;

  return (
    <div className="shell">
      <Masthead title="Modules" onSynced={refresh}>
        <p className="dek">
          {items.length} item{items.length === 1 ? "" : "s"} across {modules.length} module
          {modules.length === 1 ? "" : "s"} · cached for offline
          {stale && " · offline copy"}
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
          <button data-active={filesOnly} onClick={() => setFilesOnly((f) => !f)}>
            Files only
          </button>
        </div>
      </div>

      {!courseModules.length ? (
        <div className="hatchbox" style={{ padding: "56px 24px" }}>
          No modules synced for this course
          <small>Open AnimoSpace with the extension installed — modules arrive with the next sync.</small>
        </div>
      ) : (
        <section className="panel">
          <PanelHead
            title="Course modules"
            count={`${linkedCount} linked to deadlines`}
          />
          {courseModules.map((m) => {
            const rows = items
              .filter((i) => i.module_id === m.id && (!filesOnly || i.type === "File"))
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            if (!rows.length) return null;
            return (
              <details className="module" key={m.id} open={courseModules.length <= 3}>
                <summary>
                  <span className="nm">{m.name}</span>
                  <span className="n">
                    {rows.length} item{rows.length === 1 ? "" : "s"}
                  </span>
                </summary>

                {rows.map((item) => {
                  const linked = deadlines.find((d) => d.id === item.deadline_id);
                  return (
                    <div className="item-row" key={item.id} data-linked={!!item.deadline_id}>
                      <span className="type">{TYPE_LABEL[item.type] ?? item.type.toLowerCase()}</span>
                      {item.html_url ? (
                        <a className="nm" href={item.html_url} target="_blank" rel="noreferrer" title={item.title}>
                          {item.title}
                        </a>
                      ) : (
                        <span className="nm" title={item.title}>
                          {item.title}
                        </span>
                      )}
                      <span style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                        {linked && (
                          <span className="linkchip" data-state={deadlineState(linked, now)}>
                            {linked.title.slice(0, 22)}
                          </span>
                        )}
                        <select
                          className="field"
                          value={item.deadline_id ?? ""}
                          onChange={(e) => link(item, e.target.value)}
                          aria-label="Link this item to a deadline"
                        >
                          <option value="">Not linked</option>
                          {linkTargets.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.title.slice(0, 44)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </div>
                  );
                })}
              </details>
            );
          })}
        </section>
      )}

      <p className="note" style={{ maxWidth: "62ch" }}>
        Linking an item to a deadline makes it show up in that deadline&apos;s panel on the dashboard, so the reading
        you need is next to the thing it is for. A sync never overwrites a link you made.
      </p>
    </div>
  );
}
