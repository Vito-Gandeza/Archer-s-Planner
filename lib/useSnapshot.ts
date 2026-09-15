"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { ClassMeeting, Course, CourseFile, Deadline, Module, ModuleItem, PlannerSnapshot } from "@/lib/types";

const CACHE_KEY = "planner.snapshot.v2";

/**
 * ponytail: the offline copy is a single localStorage blob rather than an
 * IndexedDB store. A term of courses/deadlines/files is well under the 5 MB
 * quota; move to IndexedDB if file metadata ever grows past that.
 */
function readCache(): PlannerSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PlannerSnapshot) : null;
  } catch {
    return null;
  }
}

export async function loadSnapshot(): Promise<PlannerSnapshot> {
  const sb = supabaseBrowser();
  const [courses, deadlines, files, components, grades, modules, moduleItems, meetings] = await Promise.all([
    sb.from("courses").select("*").order("code"),
    sb.from("deadlines").select("*").order("due_at", { nullsFirst: false }),
    sb.from("files").select("*"),
    sb.from("grade_components").select("*"),
    sb.from("grades").select("*"),
    sb.from("modules").select("*").order("position", { nullsFirst: false }),
    sb.from("module_items").select("*").order("position", { nullsFirst: false }),
    sb.from("class_meetings").select("*").order("starts_at"),
  ]);
  const failed = [courses, deadlines, files, components, grades, modules, moduleItems, meetings].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  return {
    courses: (courses.data ?? []) as Course[],
    deadlines: (deadlines.data ?? []) as Deadline[],
    files: (files.data ?? []) as CourseFile[],
    components: (components.data ?? []) as PlannerSnapshot["components"],
    grades: (grades.data ?? []) as PlannerSnapshot["grades"],
    modules: (modules.data ?? []) as Module[],
    moduleItems: (moduleItems.data ?? []) as ModuleItem[],
    meetings: (meetings.data ?? []) as ClassMeeting[],
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Loads from the cache first so the page paints instantly and offline, then
 * refreshes from Supabase. `stale` is true while what is on screen came from
 * the cache rather than the network.
 */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<PlannerSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await loadSnapshot();
      setSnapshot(next);
      setStale(false);
      setError(null);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next));
      } catch {
        /* quota or private mode — the app still works, just without an offline copy */
      }
    } catch (e) {
      const cached = readCache();
      if (cached) {
        setSnapshot(cached);
        setStale(true);
      } else {
        setError(e instanceof Error ? e.message : "Could not load your planner.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setSnapshot(cached);
      setStale(true);
      setLoading(false);
    }
    refresh();
    const onFocus = () => refresh();
    const onOnline = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh]);

  return { snapshot, stale, error, loading, refresh };
}
