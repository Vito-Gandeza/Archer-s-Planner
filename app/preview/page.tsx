"use client";

/**
 * Design harness: the real dashboard rendered against fixture data, with no
 * Supabase and no sign-in. The fixture is passed as a prop rather than written
 * to the offline cache, so visiting this page cannot leave sample courses
 * behind for the real app to read back.
 */

import Dashboard from "@/components/Dashboard";
import { weekStart, DAY_MS } from "@/lib/planner.mjs";
import type { PlannerSnapshot } from "@/lib/types";

const now = new Date();
const monday = weekStart(now) as Date;
const at = (dayOffset: number, hour: number, min = 0) =>
  new Date(monday.getTime() + dayOffset * DAY_MS + (hour * 60 + min) * 60000).toISOString();

const FIXTURE: PlannerSnapshot = {
  courses: [
    { id: "c1", canvas_course_id: "1", code: "MICPROS", name: "Microprocessors", instructor: "F. Dimaculangan", room: "A705", color: null },
    { id: "c2", canvas_course_id: "2", code: "DIGDACM", name: "Data & Digital Communications", instructor: "G. Arada", room: "G207", color: null },
    { id: "c3", canvas_course_id: "3", code: "LBYCPB3", name: "CpE Drafting & Design Laboratory", instructor: "M. Padilla", room: "V310", color: null },
    { id: "c4", canvas_course_id: "4", code: "NUMMETS", name: "Numerical Methods", instructor: "S. Magon", room: "V308", color: null },
    { id: "c5", canvas_course_id: "5", code: "ECNOMIC", name: "Engineering Economy", instructor: "H. Verano", room: "A705", color: null },
  ],
  deadlines: [
    { id: "d1", course_id: "c3", canvas_assignment_id: "1", title: "Plate 4 — isometric assembly drawing", due_at: at(0, 11, 0), type: "assignment", points_possible: 100, canvas_url: null, status: "open" },
    { id: "d2", course_id: "c1", canvas_assignment_id: "2", title: "Quiz 2 — addressing modes", due_at: at(1, 9, 15), type: "quiz", points_possible: 40, canvas_url: null, status: "open" },
    { id: "d3", course_id: "c2", canvas_assignment_id: "3", title: "Problem set 3 — line coding", due_at: at(2, 23, 59), type: "assignment", points_possible: 50, canvas_url: null, status: "open" },
    { id: "d4", course_id: "c4", canvas_assignment_id: "4", title: "Machine problem 1 — Newton-Raphson", due_at: at(3, 23, 59), type: "assignment", points_possible: 100, canvas_url: null, status: "open" },
    { id: "d5", course_id: "c5", canvas_assignment_id: "5", title: "Case study writeup", due_at: at(4, 16, 15), type: "assignment", points_possible: 60, canvas_url: null, status: "open" },
    { id: "d6", course_id: "c1", canvas_assignment_id: "6", title: "Laboratory report 3", due_at: at(4, 23, 30), type: "assignment", points_possible: 30, canvas_url: null, status: "open" },
    { id: "d7", course_id: "c2", canvas_assignment_id: "7", title: "Long exam 1", due_at: at(6, 11, 0), type: "exam", points_possible: 100, canvas_url: null, status: "open" },
    { id: "d8", course_id: "c4", canvas_assignment_id: "8", title: "Seatwork 5", due_at: at(1, 16, 15), type: "assignment", points_possible: 20, canvas_url: null, status: "graded" },
    { id: "d9", course_id: "c5", canvas_assignment_id: "9", title: "Group project proposal", due_at: null, type: "assignment", points_possible: 80, canvas_url: null, status: "open" },
  ],
  files: [
    { id: "f1", course_id: "c3", deadline_id: "d1", canvas_file_id: "10", filename: "plate4-spec.pdf", content_type: "application/pdf", size_bytes: 240_000, canvas_url: null, storage_path: null, parsed_at: null },
    { id: "f2", course_id: "c4", deadline_id: "d4", canvas_file_id: "11", filename: "mp1-template.m", content_type: "text/plain", size_bytes: 4_000, canvas_url: null, storage_path: null, parsed_at: null },
    { id: "f3", course_id: "c4", deadline_id: "d4", canvas_file_id: "12", filename: "mp1-rubric.pdf", content_type: "application/pdf", size_bytes: 88_000, canvas_url: null, storage_path: null, parsed_at: null },
    { id: "f4", course_id: "c1", deadline_id: null, canvas_file_id: "13", filename: "8085-instruction-set.pdf", content_type: "application/pdf", size_bytes: 512_000, canvas_url: null, storage_path: null, parsed_at: null },
  ],
  components: [
    { id: "gc1", course_id: "c1", label: "Quizzes", weight_percent: 30, source: "ai_extracted" },
    { id: "gc2", course_id: "c1", label: "Machine Problems", weight_percent: 30, source: "ai_extracted" },
    { id: "gc3", course_id: "c1", label: "Final Exam", weight_percent: 40, source: "ai_extracted" },
    { id: "gc4", course_id: "c2", label: "Long Exams", weight_percent: 60, source: "manual" },
    { id: "gc5", course_id: "c2", label: "Problem Sets", weight_percent: 40, source: "manual" },
    { id: "gc6", course_id: "c4", label: "Machine Problems", weight_percent: 50, source: "ai_extracted" },
    { id: "gc7", course_id: "c4", label: "Final Exam", weight_percent: 50, source: "ai_extracted" },
  ],
  grades: [
    { id: "g1", course_id: "c1", component_id: "gc1", label: "Quizzes", score: 36, max_score: 40, source: "manual" },
    { id: "g2", course_id: "c2", component_id: "gc5", label: "Problem Sets", score: 44, max_score: 50, source: "manual" },
    { id: "g3", course_id: "c4", component_id: "gc6", label: "Machine Problems", score: 71, max_score: 100, source: "manual" },
  ],
  syncedAt: new Date().toISOString(),
};

export default function Preview() {
  return <Dashboard fixture={FIXTURE} />;
}
