import { KIND_LABEL } from './defaults';
import { formatGrade, itemPercent } from './grades';
import { sortByDue } from './schedule';
import type { AppData } from './types';

function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' } as const;

/** One row per assignment / exam / task — opens in Excel, Numbers or Google Sheets. */
export function itemsToCsv(data: AppData): string {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const semesters = new Map(data.semesters.map((s) => [s.id, s]));
  const header = ['Title', 'Type', 'Course', 'Semester', 'Due date', 'Due time', 'Status', 'Priority', 'Weight (%)', 'Score', 'Out of', 'Grade', 'Description', 'Notes'];
  const rows = [header.map(cell).join(',')];
  for (const it of sortByDue(data.items)) {
    const course = it.courseId ? courses.get(it.courseId) : undefined;
    const sem = course?.semesterId ? semesters.get(course.semesterId) : undefined;
    const p = itemPercent(it);
    rows.push(
      [
        it.title,
        KIND_LABEL[it.kind],
        course?.name ?? '',
        sem?.name ?? '',
        it.dueDate,
        it.dueTime,
        STATUS_LABEL[it.status],
        it.priority,
        it.weight,
        it.score,
        it.maxScore,
        p === null ? '' : formatGrade(p, data.settings.gradeScale),
        it.description,
        it.notes,
      ]
        .map(cell)
        .join(','),
    );
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}
