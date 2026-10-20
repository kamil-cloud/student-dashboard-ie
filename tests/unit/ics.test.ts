import { describe, expect, it } from 'vitest';
import { applyIcs, exportIcs, looksLikeDeadline, parseIcs } from '../../src/integrations/ics';
import { emptyData, newCourse, newItem } from '../../src/lib/defaults';
import type { AppData } from '../../src/lib/types';

const NOW = new Date('2026-10-01T10:00:00');

function sample(): AppData {
  const d = emptyData();
  const c = newCourse({ name: 'Management Control', code: 'MC' });
  c.sessions = [
    { id: 's1', date: '2026-10-06', start: '17:30', end: '18:50', room: 'T-11.02', title: 'Transfer pricing', mode: 'in_person', extId: null },
    { id: 's0', date: '2026-09-20', start: '17:30', end: '18:50', room: 'T-11.02', title: 'Past', mode: 'in_person', extId: null },
  ];
  d.courses.push(c);
  d.items.push(
    newItem({ title: 'Essay; part 1, draft', courseId: c.id, kind: 'assignment', dueDate: '2026-10-10', dueTime: '23:59', reminder: '1d', weight: 20 }),
    newItem({ title: 'Final exam', courseId: c.id, kind: 'exam', dueDate: '2026-12-15', dueTime: null, reminder: '1w' }),
    newItem({ title: 'Done already', courseId: c.id, dueDate: '2026-10-12', status: 'completed', completedAt: NOW.toISOString() }),
    newItem({ title: 'Long ago', courseId: c.id, dueDate: '2026-09-01' }),
  );
  return d;
}

describe('calendar export', () => {
  it('writes upcoming deadlines, exams and classes with reminders', () => {
    const { ics, count } = exportIcs(sample(), { deadlines: true, classes: true }, NOW);
    expect(count).toBe(3);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Essay\\; part 1\\, draft · MC');
    expect(ics).toContain('DTSTART:20261010T235900');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215');
    expect(ics).toContain('DTEND;VALUE=DATE:20261216');
    expect(ics).toContain('LOCATION:T-11.02');
    expect(ics).not.toContain('Done already');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it('round-trips through the parser', () => {
    const events = parseIcs(exportIcs(sample(), { deadlines: true, classes: false }, NOW).ics);
    expect(events.map((e) => [e.summary, e.date, e.time])).toEqual([
      ['Essay; part 1, draft · MC', '2026-10-10', '23:59'],
      ['Final exam · MC', '2026-12-15', null],
    ]);
  });
});

describe('calendar import', () => {
  const file = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:canvas-1',
    'SUMMARY:Problem set 3 [Management Control]',
    'DTSTART:20261020T215900Z',
    'DTEND:20261020T215900Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:lecture-1',
    'SUMMARY:Lecture: budgeting',
    'DTSTART;TZID=Europe/Madrid:20261021T090000',
    'DTEND;TZID=Europe/Madrid:20261021T103000',
    'DESCRIPTION:Bring the',
    '  case',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('parses events (UTC, time zones, folded lines)', () => {
    const events = parseIcs(file);
    expect(events).toHaveLength(2);
    expect(events[0].date).toBe('2026-10-20');
    expect(events[1]).toMatchObject({ time: '09:00', durationMin: 90, description: 'Bring the case' });
    expect(looksLikeDeadline(events[0])).toBe(true);
    expect(looksLikeDeadline(events[1])).toBe(false);
  });

  it('adds deadlines to the right course and updates them on re-import', () => {
    const data = sample();
    const events = parseIcs(file).slice(0, 1);
    const first = applyIcs(data, events);
    expect(first.added).toBe(1);
    const item = first.data.items.find((i) => i.source?.id === 'ics:canvas-1')!;
    expect(item.courseId).toBe(data.courses[0].id);
    expect(item.kind).toBe('assignment');
    const moved = applyIcs(first.data, [{ ...events[0], date: '2026-10-22' }]);
    expect(moved).toMatchObject({ added: 0, updated: 1 });
    expect(moved.data.items.filter((i) => i.source?.id === 'ics:canvas-1')).toHaveLength(1);
  });
});
