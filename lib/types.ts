export type Course = {
  id: string;
  canvas_course_id: string;
  code: string;
  name: string;
  instructor: string | null;
  room: string | null;
  color: string | null;
};

export type DeadlineType = "assignment" | "quiz" | "exam" | "discussion" | "other";
export type DeadlineStatus = "open" | "submitted" | "graded" | "dismissed";

export type Deadline = {
  id: string;
  course_id: string;
  canvas_assignment_id: string;
  title: string;
  due_at: string | null;
  type: DeadlineType;
  points_possible: number | null;
  canvas_url: string | null;
  status: DeadlineStatus;
};

export type CourseFile = {
  id: string;
  course_id: string;
  deadline_id: string | null;
  canvas_file_id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  canvas_url: string | null;
  storage_path: string | null;
  parsed_at: string | null;
};

export type GradeComponent = {
  id: string;
  course_id: string;
  label: string;
  weight_percent: number;
  source: "ai_extracted" | "manual";
};

export type Grade = {
  id: string;
  course_id: string;
  component_id: string | null;
  label: string | null;
  score: number | null;
  max_score: number | null;
  source: "scraped" | "manual";
};

/** Everything the timeline needs in one payload — also what gets cached offline. */
export type PlannerSnapshot = {
  courses: Course[];
  deadlines: Deadline[];
  files: CourseFile[];
  components: GradeComponent[];
  grades: Grade[];
  syncedAt: string;
};
