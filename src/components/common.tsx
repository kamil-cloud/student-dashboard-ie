import { BookOpen, CheckCircle2, Circle, CircleDot, ClipboardList, Flag, FlaskConical, GraduationCap, ListTodo, Mic, User } from 'lucide-react';
import type { Course, ItemKind, ItemStatus, Priority } from '../lib/types';

export const COURSE_COLORS = 8;

export function courseColor(index: number): string {
  return `var(--course-${((index % COURSE_COLORS) + COURSE_COLORS) % COURSE_COLORS})`;
}

export function CourseTag({ course, compact = false }: { course: Course | undefined | null; compact?: boolean }) {
  if (!course) return compact ? null : <span className="course-tag is-none">No course</span>;
  return (
    <span className="course-tag" title={course.name}>
      <span className="course-dot" style={{ background: courseColor(course.color) }} aria-hidden />
      <span className="course-tag-name">{compact && course.code ? course.code : course.name}</span>
    </span>
  );
}

export const KIND_ICON: Record<ItemKind, typeof BookOpen> = {
  assignment: ClipboardList,
  exam: GraduationCap,
  project: FlaskConical,
  quiz: ListTodo,
  participation: Mic,
  personal: User,
};

export function KindIcon({ kind, size = 14 }: { kind: ItemKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} aria-hidden className={`kind-icon kind-${kind}`} />;
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

export function StatusPill({ status }: { status: ItemStatus }) {
  const Icon = status === 'completed' ? CheckCircle2 : status === 'in_progress' ? CircleDot : Circle;
  return (
    <span className={`status-pill status-${status}`}>
      <Icon size={13} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export function PriorityBadge({ priority, showLow = false }: { priority: Priority; showLow?: boolean }) {
  if (priority === 'low' && !showLow) return null;
  return (
    <span className={`priority priority-${priority}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      <Flag size={12} aria-hidden />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
