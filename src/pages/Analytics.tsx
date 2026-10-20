import { useMemo, useState } from 'react';
import { AlarmClock, BarChart3, CheckCircle2, Clock, GraduationCap } from 'lucide-react';
import { EmptyState, PageHeader } from '../components/ui';
import { ChartCard, HBarChart, SimpleBarChart, SimpleLineChart, StackedBarChart, StatTile } from '../components/charts';
import { addDays, formatDate, parseDateStr, startOfWeek, toDateStr, todayStr } from '../lib/dates';
import { computeGpa, courseGrade, formatGpa, formatGrade, GPA_MAX, SCALE_MAX, toScale } from '../lib/grades';
import { formatNumber, round } from '../lib/format';
import { currentSemester, dueMoment, isOverdue, isTask, semesterProgress, sortSemesters } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Item, ItemKind } from '../lib/types';

type Group = 'assignment' | 'exam' | 'project' | 'personal';
const GROUP_OF: Record<ItemKind, Group> = { assignment: 'assignment', quiz: 'assignment', participation: 'assignment', exam: 'exam', project: 'project', personal: 'personal' };
const GROUPS: { key: Group; name: string; color: string }[] = [
  { key: 'assignment', name: 'Assignments', color: 'var(--series-1)' },
  { key: 'exam', name: 'Exams', color: 'var(--series-2)' },
  { key: 'project', name: 'Projects', color: 'var(--series-3)' },
  { key: 'personal', name: 'Personal', color: 'var(--series-4)' },
];

export function Analytics() {
  const { data } = useStore();
  const { settings } = data;
  const cur = currentSemester(data);
  const [semId, setSemId] = useState<string>(() => cur?.id ?? 'all');
  const today = todayStr();
  const now = new Date();
  const scale = settings.gradeScale;

  // ---- GPA progression (all semesters, chronological) ----
  const gpaRows = useMemo(() => {
    const sems = sortSemesters(data.semesters);
    const rows: { label: string; semester: number | null; cumulative: number | null }[] = [];
    const seen: typeof data.courses = [];
    for (const s of sems) {
      const cs = data.courses.filter((c) => c.semesterId === s.id);
      seen.push(...cs);
      const semGpa = computeGpa(cs, data.items, settings).gpa;
      if (semGpa === null) continue;
      const cum = computeGpa(seen, data.items, settings, { finalOnly: true }).gpa ?? computeGpa(seen, data.items, settings).gpa;
      const inProgress = semesterProgress(s, today)?.status === 'active';
      rows.push({ label: inProgress ? `${s.name} (in progress)` : s.name, semester: round(semGpa, 2), cumulative: cum === null ? null : round(cum, 2) });
    }
    return rows;
  }, [data, settings]);

  // ---- Scope for the rest ----
  const semesters = sortSemesters(data.semesters).reverse();
  const filter = semId !== 'all' && !data.semesters.some((s) => s.id === semId) ? 'all' : semId;
  const courses = data.courses.filter((c) => filter === 'all' || c.semesterId === filter);
  const courseIds = new Set(courses.map((c) => c.id));
  const items: Item[] = data.items.filter((i) => isTask(i) && (filter === 'all' || (i.courseId ? courseIds.has(i.courseId) : true)));

  // ---- Course performance ----
  const perf = courses
    .map((c) => ({ name: c.name, short: c.code || (c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name), grade: courseGrade(c, data.items).effective }))
    .filter((r): r is { name: string; short: string; grade: number } => r.grade !== null)
    .map((r) => ({ name: r.name, short: r.short, value: round(toScale(r.grade, scale), 2) }))
    .sort((a, b) => b.value - a.value);

  // ---- Workload: deadlines per week, past 4 → next 7 weeks ----
  const thisWeek = startOfWeek(now, settings.weekStartsOn);
  const workload = Array.from({ length: 12 }, (_, i) => {
    const start = addDays(thisWeek, (i - 4) * 7);
    const s = toDateStr(start);
    const e = toDateStr(addDays(start, 6));
    const row: Record<string, string | number> = { label: formatDate.short(s), range: `Week of ${formatDate.medium(s)}${i === 4 ? ' (this week)' : ''}` };
    for (const g of GROUPS) row[g.key] = 0;
    for (const it of items) if (it.dueDate && it.dueDate >= s && it.dueDate <= e) row[GROUP_OF[it.kind]] = (row[GROUP_OF[it.kind]] as number) + 1;
    return row;
  });
  const workloadTotal = workload.reduce((s, r) => s + GROUPS.reduce((t, g) => t + (r[g.key] as number), 0), 0);

  // ---- Completed per week (last 12 weeks) ----
  const completed = items.filter((i) => i.status === 'completed' && i.completedAt);
  const completedRows = Array.from({ length: 12 }, (_, i) => {
    const start = addDays(thisWeek, (i - 11) * 7);
    const s = toDateStr(start);
    const e = toDateStr(addDays(start, 6));
    const n = completed.filter((it) => {
      const d = toDateStr(new Date(it.completedAt!));
      return d >= s && d <= e;
    }).length;
    return { label: formatDate.short(s), range: `Week of ${formatDate.medium(s)}`, completed: n };
  });
  const withDue = completed.filter((i) => i.dueDate);
  const onTime = withDue.filter((i) => new Date(i.completedAt!).getTime() <= (dueMoment(i)?.getTime() ?? Infinity)).length;
  // Completion counts work that is already due (or done) — future deadlines aren't late yet.
  const dueSoFar = items.filter((i) => i.status === 'completed' || (i.dueDate !== null && (dueMoment(i)?.getTime() ?? 0) <= now.getTime()));
  const completionRate = dueSoFar.length ? (completed.length / dueSoFar.length) * 100 : null;
  const overdue = items.filter((i) => isOverdue(i, now)).length;

  // ---- Upcoming deadlines (next 14 days) ----
  const upcomingRows = Array.from({ length: 14 }, (_, i) => {
    const d = toDateStr(addDays(parseDateStr(today), i));
    const due = items.filter((it) => it.dueDate === d && it.status !== 'completed');
    return { label: i === 0 ? 'Today' : formatDate.short(d), date: d, deadlines: due.length, titles: due.map((x) => x.title).join(', ') };
  });
  const upcomingTotal = upcomingRows.reduce((s, r) => s + r.deadlines, 0);

  const gpaFmt = (v: number) => formatGpa(v, settings.gpaScale);
  const scaleMax = SCALE_MAX[scale];

  return (
    <div className="page">
      <PageHeader title="Analytics" subtitle="How your semester is going" />

      <ChartCard
        title="GPA progression"
        subtitle={`Per semester and cumulative · ${settings.gpaScale === 'hundred' ? '%' : `out of ${GPA_MAX[settings.gpaScale]}`}`}
        legend={[
          { label: 'Semester GPA', color: 'var(--series-1)', type: 'line' },
          { label: 'Cumulative GPA', color: 'var(--series-2)', type: 'line' },
        ]}
        table={{ columns: ['Semester', 'Semester GPA', 'Cumulative GPA'], rows: gpaRows.map((r) => [r.label, gpaFmt(r.semester ?? 0), r.cumulative === null ? '—' : gpaFmt(r.cumulative)]) }}
        empty={gpaRows.length === 0 && <EmptyState compact icon={<GraduationCap size={22} />} title="No GPA yet" description="Enter grades for courses in a semester to chart your GPA." />}
      >
        <SimpleLineChart
          data={gpaRows}
          xKey="label"
          series={[
            { key: 'semester', name: 'Semester GPA', color: 'var(--series-1)' },
            { key: 'cumulative', name: 'Cumulative GPA', color: 'var(--series-2)' },
          ]}
          format={gpaFmt}
          tickFormat={(v) => formatNumber(v, 1)}
          height={220}
        />
        {gpaRows.length === 1 && <p className="chart-hint">One semester so far — the line grows as you add more semesters.</p>}
      </ChartCard>

      <div className="filter-row filter-row-top">
        <span className="muted small">Showing</span>
        <select className="input select filter-select" value={filter} onChange={(e) => setSemId(e.target.value)} aria-label="Semester">
          <option value="all">All semesters</option>
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.id === cur?.id ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="stat-grid">
        <StatTile label="Completion rate" value={completionRate === null ? '—' : `${formatNumber(completionRate, 0)}%`} icon={<CheckCircle2 size={16} />} progress={completionRate === null ? undefined : completionRate / 100} sub={`${completed.length} of ${dueSoFar.length} tasks due so far`} />
        <StatTile label="On-time rate" value={withDue.length ? `${formatNumber((onTime / withDue.length) * 100, 0)}%` : '—'} icon={<Clock size={16} />} sub={withDue.length ? `${onTime} of ${withDue.length} finished before the deadline` : 'No completed deadlines yet'} />
        <StatTile label="Overdue now" value={overdue} icon={<AlarmClock size={16} />} sub={overdue ? 'Open tasks past their deadline' : 'Nothing overdue'} />
        <StatTile label="Next 14 days" value={upcomingTotal} unit="deadlines" icon={<BarChart3 size={16} />} sub={`${upcomingRows.filter((r) => r.deadlines > 0).length} busy days`} />
      </div>

      <div className="grid-2">
        <ChartCard
          title="Course performance"
          subtitle={`Current grade per course · out of ${scaleMax}`}
          table={{ columns: ['Course', 'Grade'], rows: perf.map((r) => [r.name, formatNumber(r.value, 2)]) }}
          empty={perf.length === 0 && <EmptyState compact icon={<GraduationCap size={22} />} title="No graded courses" description="Grades you enter show up here." />}
        >
          <HBarChart data={perf} labelKey="short" valueKey="value" name="Grade" labelOf={(r) => String(r.name)} max={scaleMax} format={(v) => formatNumber(v, 2)} reference={{ value: toScale(settings.passPercent, scale), label: `Pass ${formatGrade(settings.passPercent, scale)}` }} />
        </ChartCard>

        <ChartCard
          title="Workload"
          subtitle="Deadlines per week · last 4 and next 7 weeks"
          legend={GROUPS.map((g) => ({ label: g.name, color: g.color, type: 'bar' as const }))}
          table={{ columns: ['Week', ...GROUPS.map((g) => g.name)], rows: workload.map((r) => [String(r.range), ...GROUPS.map((g) => r[g.key] as number)]) }}
          empty={workloadTotal === 0 && <EmptyState compact icon={<BarChart3 size={22} />} title="No deadlines in this period" />}
        >
          <StackedBarChart data={workload} xKey="label" series={GROUPS} format={(v) => `${v}`} labelOf={(r) => String(r.range)} />
        </ChartCard>
      </div>

      <div className="grid-2">
        <ChartCard
          title="Completed assignments"
          subtitle="Tasks completed per week · last 12 weeks"
          table={{ columns: ['Week', 'Completed'], rows: [...completedRows].reverse().map((r) => [r.range, r.completed]) }}
          empty={completed.length === 0 && <EmptyState compact icon={<CheckCircle2 size={22} />} title="Nothing completed yet" description="Tick off tasks to see your progress." />}
        >
          <SimpleBarChart data={completedRows} xKey="label" yKey="completed" name="Completed" allowDecimals={false} tickFormat={(v) => String(v)} format={(v) => `${v} completed`} labelOf={(r) => String(r.range)} />
        </ChartCard>

        <ChartCard
          title="Upcoming deadlines"
          subtitle="Open deadlines per day · next 14 days"
          table={{ columns: ['Day', 'Deadlines', 'Tasks'], rows: upcomingRows.filter((r) => r.deadlines > 0).map((r) => [formatDate.medium(r.date), r.deadlines, r.titles]) }}
          empty={upcomingTotal === 0 && <EmptyState compact icon={<AlarmClock size={22} />} title="No upcoming deadlines" />}
        >
          <SimpleBarChart data={upcomingRows} xKey="label" yKey="deadlines" name="Deadlines" allowDecimals={false} tickFormat={(v) => String(v)} format={(v) => `${v} due`} labelOf={(r) => `${formatDate.long(String(r.date))}${r.titles ? ` — ${String(r.titles)}` : ''}`} />
        </ChartCard>
      </div>
    </div>
  );
}
