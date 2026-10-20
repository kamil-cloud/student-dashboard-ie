import type { Course } from './types';

export interface AttendanceStats {
  recorded: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Attended (present + late) / sessions that count (excused ones don't), in percent. */
  rate: number | null;
  /** Absences allowed over the whole course, if the total number of sessions is known. */
  maxAbsences: number | null;
  remainingAbsences: number | null;
  belowMinimum: boolean;
}

export function attendanceStats(course: Pick<Course, 'attendance' | 'totalSessions'>, minAttendance: number): AttendanceStats {
  const c = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const r of course.attendance) c[r.status] += 1;
  const recorded = course.attendance.length;
  const counted = recorded - c.excused;
  const rate = counted > 0 ? ((c.present + c.late) / counted) * 100 : null;
  const maxAbsences = course.totalSessions ? Math.floor(course.totalSessions * (1 - minAttendance / 100) + 1e-9) : null;
  return {
    recorded,
    ...c,
    rate,
    maxAbsences,
    remainingAbsences: maxAbsences === null ? null : maxAbsences - c.absent,
    belowMinimum: rate !== null && rate + 1e-9 < minAttendance,
  };
}

/** Attendance across several courses, weighting every recorded session equally. */
export function overallAttendance(courses: Course[]): number | null {
  let attended = 0;
  let counted = 0;
  for (const course of courses) {
    for (const r of course.attendance) {
      if (r.status === 'excused') continue;
      counted += 1;
      if (r.status === 'present' || r.status === 'late') attended += 1;
    }
  }
  return counted > 0 ? (attended / counted) * 100 : null;
}
