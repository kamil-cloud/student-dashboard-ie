/**
 * Applies a Blackboard snapshot to the app data. Pure (returns new data), idempotent (applying
 * the same snapshot twice changes nothing) and conservative:
 *  - courses are linked to existing ones (e.g. from the transcript) by name, never duplicated;
 *  - your edits win, except official fields (deadlines, grades) that change on Blackboard;
 *  - something that disappears from Blackboard is only deleted if you never touched it.
 */
import { produce, type Draft } from 'immer';
import { newCourse, newItem, newSemester } from '../../lib/defaults';
import type { AppData, ClassSession, Course, Item, ItemKind, ItemStatus, Semester } from '../../lib/types';
import { abbreviate, mergeFields, nameSimilarity, normalizeName } from '../common';
import { semesterDates } from '../transcript/apply';
import {
  classifyKind,
  cleanCourseName,
  cleanItemTitle,
  criterionClass,
  examKindOf,
  gradeScore,
  isIgnoredColumn,
  isParticipationName,
  isSupplementaryProgram,
  localParts,
  matchCriteria,
  parseSession,
  parseTerm,
  periodStart,
  personName,
  stripHtml,
  type ParsedSession,
} from './parse';
import type { BbCalendarItem, BbColumn, BbCourseData, BbGrade, BbSnapshot } from './types';

export interface BbApplySummary {
  coursesAdded: number;
  coursesLinked: number;
  semestersAdded: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsRemoved: number;
  sessions: number;
  newGrades: { title: string; course: string }[];
  dueChanges: { title: string; course: string; to: string | null }[];
  /** Course names read partly (errors). */
  partial: string[];
}

interface Desired {
  extId: string;
  kind: ItemKind;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  maxScore: number | null;
  score: number | null;
  weight: number | null;
  /** Graded or submitted on Blackboard. */
  done: boolean;
  /** When it was graded or submitted, if Blackboard says. */
  doneAt: string | null;
  /** Comes from the syllabus (only refreshed when the syllabus was read). */
  fromSyllabus: boolean;
}

const SEMESTER_SEASON = (key: string): string | null => {
  const m = /^(\d{2})\/(\d{2})-(S1|S2)$/.exec(key);
  if (!m) return null;
  const y = 2000 + Number(m[1]);
  return m[3] === 'S1' ? `Fall ${y}` : `Spring ${y + 1}`;
};

const slug = (s: string) => normalizeName(s).replace(/\s+/g, '-').slice(0, 48);

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '';
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** Semester key for a Blackboard term: "26/27-S1"; year-long courses go to the half we are in. */
function semesterKeyFor(cd: BbCourseData, now: Date): { key: string; info: ReturnType<typeof parseTerm> } {
  const info = parseTerm(cd.term);
  if (info.academicYear && info.half) {
    let half = info.half;
    if (half === 'annual') {
      const y = 2000 + Number(info.academicYear.slice(0, 2));
      half = now <= new Date(y, 11, 31, 23, 59) ? 'S1' : 'S2';
    }
    return { key: `${info.academicYear}-${half}`, info };
  }
  return { key: `bb:term:${cd.term?.id ?? 'none'}`, info };
}

function dueParts(iso: string | null, floor: string | null): { dueDate: string | null; dueTime: string | null } {
  if (!iso) return { dueDate: null, dueTime: null };
  const p = localParts(iso);
  if (!p) return { dueDate: null, dueTime: null };
  // Columns copied from an older course keep their old due dates: ignore those.
  if (floor && p.date < floor) return { dueDate: null, dueTime: null };
  return { dueDate: p.date, dueTime: p.time };
}

/** Everything one course should contain, as derived from Blackboard. */
function deriveItems(cd: BbCourseData, sessions: ParsedSession[], calendar: BbCalendarItem[], floor: string | null): Desired[] {
  const pk = cd.course.id;
  const grades = new Map<string, BbGrade>(cd.grades.map((g) => [g.columnId, g]));
  const cols = cd.columns.filter((c) => !isIgnoredColumn(c));
  // Per-session participation marks ("Participation - 2026-09-09") are folded into one item.
  const participation = cols.filter((c) => isParticipationName(c.name) && !c.due);
  const tasks = cols.filter((c) => !participation.includes(c));
  const criteria = cd.syllabus?.criteria ?? [];
  const matches = matchCriteria(criteria, tasks);

  const weightOf = new Map<string, number>();
  for (const [i, list] of matches) for (const col of list) weightOf.set(col.id, Math.round((criteria[i].weight / list.length) * 100) / 100);

  const examSession = (kind: 'final' | 'midterm') => {
    const hits = sessions.filter((s) => examKindOf(`${s.topic} ${s.label}`) === kind);
    const s = kind === 'final' ? hits[hits.length - 1] : hits[0];
    return s ? { dueDate: s.date, dueTime: s.start } : null;
  };

  const out: Desired[] = [];
  const fromColumn = (col: BbColumn): Desired => {
    const g = grades.get(col.id);
    const score = gradeScore(g, col.possible);
    let due = dueParts(col.due, floor);
    const ek = examKindOf(col.name);
    if (!due.dueDate && ek) due = examSession(ek) ?? due;
    return {
      extId: `bb:col:${pk}:${col.id}`,
      kind: classifyKind(col.name),
      title: cleanItemTitle(col.name) || col.name,
      description: stripHtml(col.description).slice(0, 2000),
      ...due,
      maxScore: col.possible,
      score,
      weight: weightOf.get(col.id) ?? null,
      done: score !== null || g?.status === 'NeedsGrading' || g?.exempt === true,
      doneAt: g?.date && !Number.isNaN(Date.parse(g.date)) ? g.date : null,
      fromSyllabus: false,
    };
  };
  for (const col of tasks) out.push(fromColumn(col));

  // One participation item, weighted by the syllabus if it has a participation criterion.
  const partIdx = criteria.findIndex((c, i) => criterionClass(c.name) === 'participation' && (matches.get(i)?.length ?? 0) === 0);
  if (participation.length > 0 || partIdx >= 0) {
    const pct = participation
      .map((c) => {
        const s = gradeScore(grades.get(c.id), c.possible);
        return s === null || !c.possible ? null : (s / c.possible) * 100;
      })
      .filter((v): v is number => v !== null);
    const avg = pct.length ? pct.reduce((a, b) => a + b, 0) / pct.length : null;
    out.push({
      extId: `bb:part:${pk}`,
      kind: 'participation',
      title: partIdx >= 0 ? criteria[partIdx].name : 'Class participation',
      description: pct.length ? `Average of ${pct.length} participation mark${pct.length === 1 ? '' : 's'} on Blackboard.` : '',
      dueDate: null,
      dueTime: null,
      maxScore: 10,
      score: avg === null ? null : Math.round(avg) / 10,
      weight: partIdx >= 0 ? criteria[partIdx].weight : null,
      done: false,
      doneAt: null,
      fromSyllabus: partIdx >= 0,
    });
  }

  // Syllabus criteria with no gradebook column yet: placeholders so the grade maths is complete.
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    if ((matches.get(i)?.length ?? 0) > 0 || i === partIdx) continue;
    const cls = criterionClass(c.name);
    const ek = examKindOf(c.name) ?? (cls === 'exam' ? 'final' : null);
    const due = ek ? examSession(ek) : null;
    out.push({
      extId: `bb:crit:${pk}:${slug(c.name)}`,
      kind: cls === 'participation' ? 'participation' : classifyKind(c.name),
      title: c.name,
      description: c.note ? `Syllabus: ${c.note}` : '',
      dueDate: due?.dueDate ?? null,
      dueTime: due?.dueTime ?? null,
      maxScore: 10,
      score: null,
      weight: c.weight,
      done: false,
      doneAt: null,
      fromSyllabus: true,
    });
  }

  // Deadlines that are on the calendar but not in the gradebook we could read.
  const known = new Set(cd.columns.map((c) => normalizeName(c.name)));
  for (const it of calendar) {
    if (it.type !== 'GradebookColumn' || it.calendarId !== pk || known.has(normalizeName(it.title))) continue;
    const due = dueParts(it.end || it.start, floor);
    if (!due.dueDate) continue;
    out.push({
      extId: `bb:cal:${it.id}`,
      kind: classifyKind(it.title),
      title: cleanItemTitle(it.title) || it.title,
      description: stripHtml(it.description).slice(0, 2000),
      ...due,
      maxScore: null,
      score: null,
      weight: null,
      done: false,
      doneAt: null,
      fromSyllabus: false,
    });
  }
  return out;
}

function toSessions(list: { item: BbCalendarItem; s: ParsedSession }[]): ClassSession[] {
  return list
    .map(({ item, s }) => ({
      id: `bb-${item.id}`,
      date: s.date,
      start: s.start,
      end: s.end,
      room: s.room,
      title: s.topic || (s.mode === 'online' ? 'Live online' : s.label),
      mode: s.mode,
      extId: `bb:cal:${item.id}`,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
}

/** Was this item changed by the user since it was imported? (then it is never deleted) */
function touched(it: Item): boolean {
  const synced = it.source?.synced ?? {};
  return it.notes.trim() !== '' || it.status !== (synced.status ?? 'not_started') || (it.score !== null && it.score !== (synced.score ?? null)) || it.title !== (synced.title ?? it.title);
}

export function applySnapshot(data: AppData, snap: BbSnapshot, now = new Date()): { data: AppData; summary: BbApplySummary } {
  const summary: BbApplySummary = {
    coursesAdded: 0,
    coursesLinked: 0,
    semestersAdded: 0,
    itemsAdded: 0,
    itemsUpdated: 0,
    itemsRemoved: 0,
    sessions: 0,
    newGrades: [],
    dueChanges: [],
    partial: snap.courses.filter((c) => c.error).map((c) => cleanCourseName(c.course.name)),
  };
  const nowIso = now.toISOString();
  const rangeStart = localParts(snap.range.since)?.date ?? '0000-00-00';
  const rangeEnd = localParts(snap.range.until)?.date ?? '9999-99-99';

  const next = produce(data, (d) => {
    d.blackboard.host = snap.host;
    d.blackboard.lastSync = snap.fetchedAt;

    const sessionsByCourse = new Map<string, { item: BbCalendarItem; s: ParsedSession }[]>();
    for (const item of snap.calendar) {
      const s = parseSession(item);
      if (!s) continue;
      const list = sessionsByCourse.get(item.calendarId) ?? [];
      list.push({ item, s });
      sessionsByCourse.set(item.calendarId, list);
    }

    const touchedSemesters = new Map<string, Draft<Semester>>();
    // Name new semesters after a degree course of that period (not e.g. a language course).
    const termInfoByKey = new Map<string, ReturnType<typeof parseTerm>>();
    for (const cd of snap.courses) {
      const { key, info } = semesterKeyFor(cd, now);
      const known = termInfoByKey.get(key);
      if (!known || (isSupplementaryProgram(known.program) && !isSupplementaryProgram(info.program))) termInfoByKey.set(key, info);
    }

    for (const cd of snap.courses) {
      const pk = cd.course.id;
      const { key, info } = semesterKeyFor(cd, now);
      const sessions = sessionsByCourse.get(pk) ?? [];
      const parsed = sessions.map((x) => x.s);

      // ---- semester ----------------------------------------------------------
      let sem = d.semesters.find((s) => s.extKey === key);
      if (!sem && /^\d{2}\/\d{2}-S[12]$/.test(key)) {
        // A semester made by hand (or in the desktop app) covering the same period: adopt it.
        const range = semesterDates(key);
        sem = d.semesters.find((s) => !s.extKey && !!s.startDate && s.startDate >= range.startDate && s.startDate <= range.endDate);
        if (sem) sem.extKey = key;
      }
      if (!sem) {
        const season = SEMESTER_SEASON(key);
        const named = termInfoByKey.get(key) ?? info;
        const degree = !isSupplementaryProgram(named.program);
        const prefix = [degree && named.program ? named.program : d.profile.program || null, degree && named.yearOfStudy ? `Y${named.yearOfStudy}` : null]
          .filter(Boolean)
          .join(' ');
        const name = season ? `${prefix ? `${prefix} · ` : ''}${season}` : cd.term?.name || 'Blackboard courses';
        const created = newSemester({ name, startDate: null, endDate: null, extKey: key, source: null });
        d.semesters.push(created);
        sem = d.semesters[d.semesters.length - 1];
        summary.semestersAdded += 1;
      }
      touchedSemesters.set(sem.id, sem);

      // ---- course ------------------------------------------------------------
      const name = cleanCourseName(cd.course.name);
      const bbId = `bb:course:${pk}`;
      const ay = info.academicYear;
      const sameYear = (c: Draft<Course>) => {
        if (c.semesterId === sem!.id) return true;
        const s = d.semesters.find((x) => x.id === c.semesterId);
        return !!ay && !!s?.extKey?.startsWith(`${ay}-`);
      };
      let course: Draft<Course> | undefined = d.courses.find((c) => c.sources.blackboard?.id === bbId);
      if (!course) {
        const candidates = d.courses.filter((c) => !c.sources.blackboard && sameYear(c)).map((c) => ({ c, score: nameSimilarity(c.name, name) }));
        candidates.sort((a, b) => b.score - a.score);
        if (candidates[0] && candidates[0].score >= 0.6) {
          course = candidates[0].c;
          summary.coursesLinked += 1;
        }
      }
      const createdHere = !course;
      if (!course) {
        const inSem = d.courses.filter((c) => c.semesterId === sem!.id);
        const used = new Set(inSem.map((c) => c.color));
        let color = 0;
        while (used.has(color) && color < 7) color += 1;
        const supplementary = isSupplementaryProgram(info.program);
        d.courses.push(
          newCourse({
            name,
            code: abbreviate(name),
            semesterId: sem.id,
            color: used.has(color) ? inSem.length % 8 : color,
            credits: cd.syllabus?.credits ?? (supplementary ? 0 : 6),
            category: supplementary ? 'supplementary' : null,
            countsInGpa: !supplementary,
          }),
        );
        course = d.courses[d.courses.length - 1];
        summary.coursesAdded += 1;
      }

      const instructor = cd.syllabus?.professor || mostFrequent(parsed.map((s) => s.instructor));
      const sessionCount = parsed.reduce((t, s) => t + s.count, 0);
      const fields: Record<string, string | number | null> = {
        professor: instructor ? personName(instructor) : null,
        room: mostFrequent(parsed.filter((s) => s.mode === 'in_person').map((s) => s.room)) || null,
        totalSessions: cd.syllabus?.sessions ?? (sessionCount > 0 ? sessionCount : null),
      };
      if (createdHere || course.sources.blackboard?.synced.credits !== undefined) {
        if (cd.syllabus?.credits) fields.credits = cd.syllabus.credits;
      }
      for (const k of Object.keys(fields)) if (fields[k] === null || fields[k] === '') delete fields[k];
      const merged = mergeFields(course as unknown as Record<string, unknown>, course.sources.blackboard?.synced, fields);
      Object.assign(course, merged.changes);
      course.sources.blackboard = { kind: 'blackboard', id: bbId, synced: merged.synced };

      // ---- class sessions: replace imported ones inside the range read --------
      if (snap.calendarComplete) {
        const fresh = toSessions(sessions);
        const keep = course.sessions.filter((s) => !s.extId?.startsWith('bb:') || s.date < rangeStart || s.date > rangeEnd);
        const before = JSON.stringify(course.sessions);
        course.sessions = [...keep, ...fresh].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? '')) as Draft<ClassSession>[];
        if (JSON.stringify(course.sessions) !== before) course.updatedAt = nowIso;
        summary.sessions += fresh.length;
      }

      // ---- assessments and deadlines -----------------------------------------
      const floorDate = ay && info.half ? periodStart(ay, info.half === 'annual' ? 'S1' : info.half) : null;
      const floor = floorDate ? new Date(Date.parse(floorDate) - 45 * 86_400_000).toISOString().slice(0, 10) : null;
      const desired = cd.error ? [] : deriveItems(cd, parsed, snap.calendar, floor);
      const desiredIds = new Set(desired.map((x) => x.extId));
      const courseItems = () => d.items.filter((i) => i.courseId === course!.id && i.source?.kind === 'blackboard');

      // A syllabus placeholder that now has exactly one gradebook column becomes that item.
      for (const want of desired) {
        if (!want.extId.startsWith('bb:col:') || d.items.some((i) => i.source?.id === want.extId)) continue;
        const placeholder = courseItems().find((i) => i.source!.id.startsWith(`bb:crit:${pk}:`) && !desiredIds.has(i.source!.id) && nameSimilarity(i.title, want.title) >= 0.5);
        if (placeholder) placeholder.source!.id = want.extId;
      }

      for (const want of desired) {
        const existing = d.items.find((i) => i.source?.id === want.extId);
        const officialFields = { title: want.title, dueDate: want.dueDate, dueTime: want.dueTime, maxScore: want.maxScore, score: want.score };
        if (!existing) {
          const status: ItemStatus = want.done ? 'completed' : 'not_started';
          const dueMs = want.dueDate ? Date.parse(`${want.dueDate}T${want.dueTime ?? '23:59'}:00`) : NaN;
          const item = newItem({
            kind: want.kind,
            courseId: course.id,
            title: want.title,
            description: want.description,
            dueDate: want.dueDate,
            dueTime: want.dueTime,
            maxScore: want.maxScore,
            score: want.maxScore === null ? null : want.score,
            weight: want.weight,
            status,
            completedAt: status === 'completed' ? (want.doneAt ?? new Date(Number.isNaN(dueMs) ? now.getTime() : Math.min(now.getTime(), dueMs)).toISOString()) : null,
            priority: want.kind === 'exam' ? 'high' : 'medium',
            reminder: want.dueDate && !want.done ? d.settings.defaultReminder : 'none',
            source: { kind: 'blackboard', id: want.extId, synced: { ...officialFields, weight: want.weight, status } },
          });
          d.items.push(item);
          summary.itemsAdded += 1;
          if (want.score !== null) summary.newGrades.push({ title: want.title, course: course.name });
          continue;
        }
        const prev = existing.source?.synced ?? {};
        const incoming: Record<string, string | number | null> = { ...officialFields };
        // Syllabus-based weights are only refreshed when the syllabus was read this time.
        if (cd.syllabus !== undefined || !want.fromSyllabus) incoming.weight = want.weight;
        const merged = mergeFields(existing as unknown as Record<string, unknown>, prev, incoming, ['dueDate', 'dueTime', 'maxScore', 'score']);
        const changes = merged.changes as Partial<Item>;
        if (existing.maxScore === null && changes.maxScore === undefined && changes.score !== undefined) delete changes.score;
        let changed = Object.keys(changes).length > 0;
        if (changes.score !== undefined && changes.score !== null && existing.score === null) summary.newGrades.push({ title: existing.title, course: course.name });
        if ('dueDate' in changes && prev.dueDate !== undefined) summary.dueChanges.push({ title: existing.title, course: course.name, to: changes.dueDate ?? null });
        Object.assign(existing, changes);
        // Graded or submitted on Blackboard: mark done (never undone automatically). This is not
        // a user edit, so the synced status follows.
        let syncedStatus = (prev.status as ItemStatus | undefined) ?? 'not_started';
        if (want.done && existing.status !== 'completed') {
          existing.status = 'completed';
          existing.completedAt = want.doneAt ?? nowIso;
          syncedStatus = 'completed';
          changed = true;
        } else if (want.done && syncedStatus !== 'completed' && existing.status === 'completed') {
          syncedStatus = 'completed';
        }
        if (existing.source?.removed) changed = true;
        existing.source = { kind: 'blackboard', id: want.extId, synced: { ...merged.synced, status: syncedStatus } };
        if (changed) {
          existing.updatedAt = nowIso;
          summary.itemsUpdated += 1;
        }
      }

      // ---- things that disappeared from Blackboard ----------------------------
      if (!cd.error) {
        for (const it of courseItems()) {
          const id = it.source!.id;
          if (desiredIds.has(id)) continue;
          if (id.startsWith(`bb:crit:${pk}:`) && cd.syllabus === undefined) continue; // syllabus not read this time
          if (id.startsWith('bb:cal:') && (!snap.calendarComplete || (it.dueDate && (it.dueDate < rangeStart || it.dueDate > rangeEnd)))) continue;
          if (!touched(it as Item)) {
            d.items.splice(d.items.indexOf(it), 1);
            summary.itemsRemoved += 1;
          } else if (!it.source!.removed) {
            it.source!.removed = true;
            it.updatedAt = nowIso;
          }
        }
      }
    }

    // ---- semester dates from the first and last class --------------------------
    for (const sem of touchedSemesters.values()) {
      const dates = d.courses
        .filter((c) => c.semesterId === sem.id)
        .flatMap((c) => c.sessions.map((s) => s.date))
        .sort();
      if (dates.length < 3) continue;
      const exams = d.items.filter((i) => i.kind === 'exam' && i.dueDate && d.courses.some((c) => c.id === i.courseId && c.semesterId === sem.id)).map((i) => i.dueDate!);
      const end = [dates[dates.length - 1], ...exams].sort().pop()!;
      const merged = mergeFields(sem as unknown as Record<string, unknown>, sem.source?.synced, { startDate: dates[0], endDate: end });
      Object.assign(sem, merged.changes);
      if (Object.keys(merged.changes).length) sem.updatedAt = nowIso;
      sem.source = { kind: 'blackboard', id: `bb:sem:${sem.extKey ?? sem.id}`, synced: merged.synced };
    }
  });
  return { data: next, summary };
}
