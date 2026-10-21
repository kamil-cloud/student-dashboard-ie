import { describe, expect, it } from 'vitest';
import { createFakeBlackboard } from '../fixtures/fake-blackboard.mjs';
import handler, { feedUrl, isPrivateAddress } from '../../api/calendar.js';
import { applySnapshot } from '../../src/integrations/blackboard/apply';
import { applyCalendarFeed, describeCalendar, normalizeFeedUrl } from '../../src/integrations/blackboard/calendarFeed';
import { BlackboardClient } from '../../src/integrations/blackboard/client';
import { fetchSnapshot } from '../../src/integrations/blackboard/snapshot';
import { parseIcs } from '../../src/integrations/ics';
import { emptyData } from '../../src/lib/defaults';
import { toDateStr, addDays } from '../../src/lib/dates';
import type { AppData } from '../../src/lib/types';

const NOW = new Date('2026-10-01T10:00:00+02:00');

function feed(bb = createFakeBlackboard({ now: NOW })) {
  return { bb, events: parseIcs(bb.feedIcs()) };
}

const ieData = (): AppData => {
  const d = emptyData();
  d.settings.university = 'ie';
  return d;
};

const fromCalendar = (d: AppData) => d.items.filter((i) => i.source?.id.startsWith('bbcal:'));

describe('Blackboard calendar link', () => {
  it('accepts the link as Blackboard gives it, and nothing else', () => {
    const link = 'https://blackboard.ie.edu/webapps/calendar/calendarFeed/abc123/learn.ics';
    expect(normalizeFeedUrl(`  ${link}  `)).toBe(link);
    expect(normalizeFeedUrl('webcal://blackboard.ie.edu/webapps/calendar/calendarFeed/abc123/learn.ics')).toBe(link);
    expect(normalizeFeedUrl('http://blackboard.ie.edu/webapps/calendar/calendarFeed/abc123/learn.ics')).toBeNull();
    expect(normalizeFeedUrl('https://blackboard.ie.edu/ultra/calendar')).toBeNull();
    expect(normalizeFeedUrl('https://user:pw@blackboard.ie.edu/x/learn.ics')).toBeNull();
    expect(normalizeFeedUrl('not a link')).toBeNull();
  });

  it('the server reads only public calendar files', () => {
    expect(feedUrl('https://blackboard.ie.edu/webapps/calendar/calendarFeed/abc/learn.ics', false)?.hostname).toBe('blackboard.ie.edu');
    expect(feedUrl('http://localhost:8080/x/learn.ics', false)).toBeNull();
    expect(feedUrl('http://localhost:8080/x/learn.ics', true)?.port).toBe('8080');
    expect(feedUrl('https://blackboard.ie.edu:8443/x/learn.ics', false)).toBeNull();
    expect(feedUrl('https://blackboard.ie.edu/x/learn.php', false)).toBeNull();
    expect(feedUrl({ url: 'x' }, false)).toBeNull();
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['193.146.120.10', '8.8.8.8', '2a00:1450:4003:80e::200e']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('the server refuses requests without a session, and other methods', async () => {
    const call = async (method: string, headers: Record<string, string> = {}) => {
      const res = { statusCode: 0, headers: {} as Record<string, string>, body: '', setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: string) { this.body = b; } };
      await handler({ method, headers, body: { url: 'https://blackboard.ie.edu/webapps/calendar/calendarFeed/abc/learn.ics' } }, res);
      return res;
    };
    expect((await call('GET')).statusCode).toBe(405);
    const anonymous = await call('POST');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['Cache-Control']).toBe('no-store');
  });

  it('turns the calendar into courses with their class sessions, and upcoming deadlines', () => {
    const { events } = feed();
    const { data, summary } = applyCalendarFeed(ieData(), events, NOW);
    const names = data.courses.map((c) => c.name).sort();
    expect(names).toEqual(['Data Analysis for Economics', 'Management Control', 'Pricing Strategy', 'Supply Chain Management']);
    const mc = data.courses.find((c) => c.name === 'Management Control')!;
    // 7 calendar entries: the Teams copy of session 3 is dropped.
    expect(mc.sessions).toHaveLength(6);
    expect(mc.sessions.find((s) => s.title === 'Transfer pricing')).toMatchObject({ room: 'T-11.02', mode: 'in_person' });
    const async = mc.sessions.find((s) => s.mode === 'async')!;
    expect(async).toMatchObject({ start: null, title: 'Exercise: budgeting' });
    expect(data.courses.find((c) => c.name === 'Data Analysis for Economics')!.sessions.filter((s) => s.mode === 'online')).toHaveLength(2);

    const today = toDateStr(NOW);
    const titles = fromCalendar(data).map((i) => i.title).sort();
    expect(titles).toEqual(['Data report submission', 'Groupal Assignment: White Hills case (20%)', 'Mock test', 'Pitch presentation', 'Problem set 1', 'Problem set 2', 'Reading quiz 2']);
    expect(fromCalendar(data).every((i) => i.dueDate! >= today)).toBe(true);
    expect(fromCalendar(data).find((i) => i.title === 'Mock test')?.kind).toBe('quiz');
    expect(summary).toMatchObject({ itemsAdded: 7, coursesAdded: 4 });
    expect(describeCalendar(summary)).toMatch(/^7 new deadlines · 4 new courses · \d+ classes$/);
    expect(data.blackboard.calendarSync).toBe(NOW.toISOString());
  });

  it('reading it again changes nothing, and keeps dates the student changed', () => {
    const { bb, events } = feed();
    const first = applyCalendarFeed(ieData(), events, NOW).data;
    const again = applyCalendarFeed(first, events, NOW);
    expect(again.summary).toMatchObject({ itemsAdded: 0, itemsUpdated: 0, coursesAdded: 0 });
    expect(again.data.items).toEqual(first.items);
    expect(again.data.courses).toEqual(first.courses);

    // The student moves "Problem set 1"; Blackboard moves "Problem set 2".
    const edited = structuredClone(first);
    const mine = edited.items.find((i) => i.title === 'Problem set 1')!;
    mine.dueDate = toDateStr(addDays(NOW, 6));
    bb.moveDue('_102_1', '_9101_1', 9);
    bb.moveDue('_102_1', '_9102_1', 25);
    const later = applyCalendarFeed(edited, parseIcs(bb.feedIcs()), NOW);
    expect(later.data.items.find((i) => i.title === 'Problem set 1')!.dueDate).toBe(toDateStr(addDays(NOW, 6)));
    expect(later.data.items.find((i) => i.title === 'Problem set 2')!.dueDate).toBe(toDateStr(addDays(NOW, 25)));
    expect(later.summary.itemsUpdated).toBe(1);
  });

  it('works alongside the bookmark: no duplicate deadlines, courses or sessions', async () => {
    const bb = createFakeBlackboard({ now: NOW });
    const client = new BlackboardClient('https://bb.test', (url: string) => bb.transport(url));
    const calendarFirst = structuredClone(applyCalendarFeed(ieData(), parseIcs(bb.feedIcs()), NOW).data);
    const done = calendarFirst.items.find((i) => i.title === 'Problem set 1')!;
    done.status = 'completed';
    done.completedAt = NOW.toISOString();

    const snap = await fetchSnapshot({ client, now: NOW });
    const both = applySnapshot(calendarFirst, snap, NOW).data;
    const after = applyCalendarFeed(both, parseIcs(bb.feedIcs()), NOW).data;

    // Courses made from the calendar were adopted by the bookmark import, not duplicated.
    const mcCourses = after.courses.filter((c) => /management control/i.test(c.name));
    expect(mcCourses).toHaveLength(1);
    expect(mcCourses[0].sources.blackboard).toBeTruthy();
    // Sessions come from Blackboard itself now.
    expect(after.courses.flatMap((c) => c.sessions).some((s) => s.extId?.startsWith('bbcal:') && after.courses.find((c) => c.sessions.includes(s))!.sources.blackboard)).toBe(false);
    // Each deadline once; what was ticked on the calendar copy carried over.
    for (const title of ['Problem set 1', 'Problem set 2', 'Reading quiz 2', 'Pitch presentation']) expect(after.items.filter((i) => i.title === title), title).toHaveLength(1);
    expect(after.items.find((i) => i.title === 'Problem set 1')).toMatchObject({ status: 'completed' });
    // A deadline only on the calendar stays.
    expect(after.items.filter((i) => i.title === 'Data report submission')).toHaveLength(1);
  });
});
