export type MessageFolder =
  | "inbox"
  | "archive"
  | "outbox"
  | "drafts"
  | "appointments";

export interface Message {
  wilmaId: number;
  subject: string;
  sentAt: Date;
  folder: MessageFolder | string;
  senderId?: number | null;
  senderType?: number | null;
  senderName?: string | null;
  sendersJson?: Record<string, unknown> | null;
  status?: number | null;
  /** In lists: Wilma hasn't seen it opened yet. */
  unread?: boolean;
  /** In lists: how many replies the thread has (read them with the message). */
  replyCount?: number;
  content?: string | null;
  /** Message detail: who it went to (Wilma may hide the list). */
  recipients?: string[] | null;
  /** Message detail: the thread's replies, oldest first. */
  replies?: MessageReply[];
  /** Message detail: the sender opened the thread for everyone ("avoin keskustelu"), so a reply goes to all recipients. */
  discussion?: boolean;
  /** Message detail: Wilma allows answering it (null when Wilma doesn't say). */
  canReply?: boolean | null;
  /** Message detail: the time slots and this family's choice, when the message is an event invitation. */
  invitation?: Invitation | null;
  fetchedAt: Date;
}

/** An event invitation (Tapahtumakutsu): a parents' evening, a learning discussion with time slots… */
export interface Invitation {
  /** Wilma asks for a sign-up, not just attendance. */
  mustApply: boolean;
  slots: InvitationSlot[];
  /** Wilma offers "En osallistu" (won't attend) for this invitation. */
  canDecline: boolean;
  /** The family has said it won't attend ("En osallistu"). */
  declined: boolean;
}

export interface InvitationSlot {
  /** Wilma's event id, for answering. */
  id: string;
  start: Date | null;
  end: Date | null;
  /** Sign-up opens / closes. */
  enrollStart: Date | null;
  enrollEnd: Date | null;
  /** The last moment a sign-up can be cancelled. */
  cancelUntil: Date | null;
  info: string;
  subject: string;
  /** 0 when there's no limit. */
  maxPeople: number;
  peopleCount: number;
  /** You signed up for this slot (Wilma: "selected-cancellable" while it can be cancelled, "selected" after). */
  selected: boolean;
  /** Another guardian signed up for this slot, as Wilma names them ("Name (child, class)"). */
  selectedByOther: string | null;
  /** Wilma's own word for the slot: "available", "selected-cancellable", "selected", "selected-other", "full", "pending", "expired", or "". */
  wilmaState: string;
  /** "En osallistu" covers this slot (CanDismissEvent). */
  canDecline: boolean;
  /** "En osallistu" was answered for this slot (IsDismissed). */
  declined: boolean;
}

/**
 * chosen: your slot (chosen-locked: too late to cancel); chosen-by-other:
 * another guardian's; taken: the family already has another slot; open: can
 * sign up now.
 */
export type InvitationSlotState = "chosen" | "chosen-locked" | "chosen-by-other" | "taken" | "open" | "full" | "not-yet" | "closed";

/** Someone a message can go to, as Wilma offers them. */
export interface MessageRecipient {
  /** As Wilma shows it, e.g. "Virtanen Sari (VIR)", or "Kaikki" for a group. */
  name: string;
  /** The list Wilma puts it in: "Omat opettajat", "Opettajat", "Henkilökunta", "Opiskelija"… */
  group: string;
  /** The school, for staff and teachers listed per school. */
  school: string | null;
  /** teacher, staff (other personnel), student (the child), guardian (the other guardians), group (several at once). */
  kind: "teacher" | "staff" | "student" | "guardian" | "group" | "other";
  /** Wilma's compose page with this recipient filled in, for prepareMessage(). */
  composePath: string;
}

/** The child's class and the people responsible for it, from the front page. */
export interface StudentDetails {
  name: string | null;
  /** E.g. "9A". */
  className: string | null;
  /** Class teacher and other supervisors, in Wilma's order. */
  supervisors: { name: string; role: string; recipient: MessageRecipient | null }[];
  /** Groups the front page offers to message at once: all supervisors, all the child's teachers. */
  messageGroups: MessageRecipient[];
}

/** An entry in the invitations list (Tapahtumakutsut). */
export interface InvitationListing {
  message: Message;
  /** Wilma's status for this family: "Applied", "ExpiredReg"…; null when it shows none. */
  status: string | null;
  /** The chosen time or the sign-up deadline, in Wilma's words. */
  extra: string | null;
}

export interface MessageReply {
  id: number;
  sentAt: Date;
  senderName: string | null;
  content: string;
}

export interface NewsItem {
  wilmaId: number;
  title: string;
  subtitle?: string | null;
  author?: string | null;
  published?: Date | null;
  content?: string | null;
  resources?: NewsResource[];
  /** A pinned bulletin (Wilma: "Pysyvät tiedotteet"), kept on the page until removed. */
  pinned?: boolean;
  /** Listed among older bulletins (Wilma: "Vanhat tiedotteet"); its date is on the bulletin itself. */
  archived?: boolean;
  fetchedAt: Date;
}

export type NewsResourceAuthContext = "external" | "wilma";

export interface NewsResource {
  id: string;
  label: string;
  url: string;
  // "wilma": downloads use the authenticated Wilma session.
  // "external": downloads use an isolated, unauthenticated fetch that never
  // carries Wilma credentials. Every resource supports a download attempt;
  // the attempt's status reports whether the URL actually served a file.
  authContext: NewsResourceAuthContext;
  fileName?: string | null;
}

export interface Exam {
  wilmaId: number;
  examDate: Date;
  /** Local date string in YYYY-MM-DD format (avoids timezone serialization issues) */
  dateString: string;
  subject: string;
  description?: string | null;
  teacher?: string | null;
  notes?: string | null;
  /** Start time ("08:30") when the school gives one; only the exam calendar has it. */
  time?: string | null;
  fetchedAt: Date;
}

export interface StudentInfo {
  studentNumber: string;
  name: string;
  href: string;
  /**
   * Whose login this is for the student, as Wilma's account roles say: a guardian's, or the student's own.
   * Missing when Wilma doesn't say (older Wilmas without the roles API).
   */
  role?: "guardian" | "student";
}

export interface Municipality {
  nameFi: string;
  nameSv: string;
}

export interface TenantInfo {
  url: string;
  name: string;
  municipalities: Municipality[];
  formerUrl?: string | null;
}

export interface TenantDiscoveryResponse {
  wilmat: TenantInfo[];
}

export interface WilmaProfile {
  baseUrl: string;
  username: string;
  password: string;
  studentNumber?: string | null;
  debug?: boolean;
}

export interface ScheduleLesson {
  /** YYYY-MM-DD */
  date: string;
  /** 1=Monday ... 5=Friday */
  dayOfWeek: number;
  start: string;
  end: string;
  subject: string;
  subjectCode: string;
  teacher: string;
  teacherCode: string;
  groupId: number;
  /** Room code(s), e.g. "407"; null when Wilma gives none. */
  room?: string | null;
}

export interface UpcomingExam {
  examId: number;
  /** YYYY-MM-DD */
  date: string;
  /** Start time ("08:30") when the school gives one (from the exam calendar). */
  time?: string | null;
  name: string;
  subject: string;
  subjectCode: string;
  topic: string | null;
  teacher: string;
  teacherCode: string;
}

export interface ExamGrade {
  examId: number;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  subject: string;
  subjectCode: string;
  grade: string;
  verbalGrade: string | null;
  info: string | null;
  teacher: string;
  teacherCode: string;
  /** When a guardian saw the grade in Wilma (YYYY-MM-DD), or null. */
  seen?: string | null;
}

/** A past exam from Wilma's exam list (Kokeet > Menneet), graded or not yet. */
export interface PastExam {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** The course title, e.g. "Fysiikka". */
  subject: string;
  /** The course code, e.g. "FY_91" ("" when Wilma doesn't give one). */
  subjectCode: string;
  /** The grade as Wilma shows it ("8+", "9½", "S", "21,5/24"), or null before it's given. */
  grade: string | null;
  verbalGrade: string | null;
  /** The exam's notes (topics, pages), lines kept. */
  info: string | null;
  /** The teachers' names, comma-separated. */
  teacher: string;
  /** The teachers' codes, comma-separated. */
  teacherCode: string;
  /** When a guardian marked the grade seen (YYYY-MM-DD), or null. */
  seen: string | null;
}

export interface HomeworkItem {
  /** YYYY-MM-DD */
  date: string;
  subject: string;
  subjectCode: string;
  homework: string;
  teacher: string;
  teacherCode: string;
}

export interface OverviewData {
  schedule: ScheduleLesson[];
  upcomingExams: UpcomingExam[];
  grades: ExamGrade[];
  homework: HomeworkItem[];
  fetchedAt: Date;
}

/**
 * A lesson note from the attendance/lesson notes page.
 * start/end are string | null — null when time-slot derivation
 * falls outside the assumed 08:00–15:00 range (see parseAttendanceHtml).
 */
export interface LessonNote {
  /** YYYY-MM-DD */
  date: string;
  start: string | null;
  end: string | null;
  subject: string;
  typeLabel: string;
  typeClass: string;
  teacher: string;
  /** The teacher's own words, when they wrote any (e.g. what was missing, or praise). */
  note?: string | null;
}

/** How many lesson notes of each kind in a period (absences, lateness, feedback…). */
export interface LessonNoteSummary {
  /** YYYY-MM-DD, or null for "the whole school year" as Wilma defines it. */
  from: string | null;
  to: string | null;
  total: number;
  byType: { type: string; count: number }[];
}

/** One row of the gradebook (Suoritukset): a subject, a syllabus or a course, with its sub-rows. */
export interface GradebookEntry {
  name: string;
  /** Course code such as "MA_81" (null for subject rows). */
  code: string | null;
  grade: string | null;
  /** Scope as Wilma shows it (e.g. "2 vvt"), if any. */
  credits: string | null;
  /** YYYY-MM-DD when completed. */
  date: string | null;
  children: GradebookEntry[];
}

/** A printable document Wilma offers as a PDF (report cards, absence reports…). */
export interface Printout {
  id: string;
  title: string;
  /** Path on this Wilma, e.g. "/!123/printouts/456.pdf". */
  path: string;
}
