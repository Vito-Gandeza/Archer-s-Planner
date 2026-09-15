export type Course = {
  id: string;
  canvas_course_id: string;
  code: string;
  name: string;
  instructor: string | null;
  room: string | null;
  color: string | null;
  /** The student's own call. A sync never writes this, so it survives re-syncs. */
  hidden: boolean;
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

export type Module = {
  id: string;
  course_id: string;
  canvas_module_id: string;
  name: string;
  position: number | null;
};

/** Canvas's own item types, plus whatever else a course throws at us. */
export type ModuleItemType = "File" | "Page" | "Assignment" | "Quiz" | "Discussion" | "ExternalUrl" | string;

export type ModuleItem = {
  id: string;
  course_id: string;
  module_id: string;
  canvas_item_id: string;
  title: string;
  type: ModuleItemType;
  html_url: string | null;
  canvas_file_id: string | null;
  /** Set by the student, never by a sync. */
  deadline_id: string | null;
  position: number | null;
};

/** weekday is 0=Monday .. 6=Sunday, matching the timeline grid. */
export type ClassMeeting = {
  id: string;
  course_id: string;
  weekday: number;
  starts_at: string; // "09:15:00"
  ends_at: string;
  room: string | null;
  mode: "lecture" | "laboratory" | "online";
};

/** Everything the dashboard needs in one payload — also what gets cached offline. */
export type PlannerSnapshot = {
  courses: Course[];
  deadlines: Deadline[];
  files: CourseFile[];
  components: GradeComponent[];
  grades: Grade[];
  modules: Module[];
  moduleItems: ModuleItem[];
  meetings: ClassMeeting[];
  syncedAt: string;
};
