import { useMemo } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  GraduationCap,
  MapPin,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';
import { SimpleBarChart, StatTile } from '../components/charts';
import { CourseTag, courseColor, StatusPill } from '../components/common';
import { useEditors } from '../components/editors';
import { ItemRow } from '../components/ItemRow';
import { DeadlineList, QuickAdd } from '../components/QuickAdd';
import { overallAttendance } from '../lib/attendance';
import { diffDays, formatDate, greeting, relativeDay, todayStr } from '../lib/dates';
import { averageGrade, computeGpa, courseGrade, formatGpa, formatGrade, GPA_MAX, requiredForTarget } from '../lib/grades';
import { formatHours, formatNumber, plural } from '../lib/format';
import { navigate } from '../lib/router';
import { classesOn, currentSemester, dueMoment, isOverdue, isTask, occurrenceMinutes, semesterProgress, sortByDue, upcoming, weekDates } from '../lib/schedule';
import { useStore } from '../lib/store';
import { IS_EXTENSION } from '../platform/env';

function Onboarding() {
  const { data } = useStore();
  const { openCourse, openItem } = useEditors();
  const steps = [
    {
      done: !!data.blackboard.lastSync,
      title: 'Import from Blackboard',
      text: 'Courses, classes and deadlines in one click — plus your transcript for grades.',
      action: () => navigate(data.profile.onboardedAt ? { name: 'settings' } : { name: 'setup' }),
      cta: 'Import',
    },
    { done: data.courses.length > 0, title: 'Add your courses', text: 'Name, professor, credits, schedule and room.', action: () => openCourse(), cta: 'Add course' },
    { done: data.items.some((i) => i.dueDate), title: 'Add deadlines', text: 'Assignments, exams, projects and personal tasks.', action: () => openItem(), cta: 'Add deadline' },
    { done: data.items.some((i) => i.score !== null), title: 'Enter grades', text: 'Your GPA and required grades update automatically.', action: () => (data.courses[0] ? navigate({ name: 'course', id: data.courses[0].id }) : openCourse()), cta: 'Enter grades' },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="card onboarding" data-testid="onboarding">
      <div className="onboarding-head">
        <div className="onboarding-icon">
          <Sparkles size={20} />
        </div>
        <div>
          <h2>Welcome to Student Dashboard</h2>
          <p>A few quick steps to get your semester organised. Everything is saved to your account.</p>
        </div>
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`step ${s.done ? 'is-done' : ''}`}>
            <span className="step-num">{s.done ? <CheckCircle2 size={18} /> : i + 1}</span>
            <span className="step-text">
              <span className="step-title">{s.title}</span>
              <span className="step-desc">{s.text}</span>
            </span>
            {!s.done && (
              <Button variant={i === steps.findIndex((x) => !x.done) ? 'primary' : 'secondary'} size="sm" onClick={s.action}>
                {s.cta}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Dashboard() {
  const { data } = useStore();
  const { openItem, openSemesters } = useEditors();
  const { settings } = data;
  const today = todayStr();
  const now = new Date();

  const semester = currentSemester(data);
  const progress = semester ? semesterProgress(semester, today) : null;
  const semCourses = useMemo(() => (semester ? data.courses.filter((c) => c.semesterId === semester.id) : data.courses), [data.courses, semester]);
  const gpa = computeGpa(semCourses, data.items, settings);
  const cumulative = computeGpa(data.courses, data.items, settings, { finalOnly: true });
  const avg = averageGrade(semCourses, data.items);
  const attendance = overallAttendance(semCourses);
  const gradedCourses = semCourses.filter((c) => courseGrade(c, data.items).effective !== null).length;
  // Share of this semester's credit-weighted grade that is already known.
  const semCredits = semCourses.reduce((s, c) => s + (c.credits > 0 ? c.credits : 0), 0);
  const gradedShare = semCredits
    ? semCourses.reduce((s, c) => {
        const g = courseGrade(c, data.items);
        return s + (c.credits > 0 ? c.credits * (g.isOverride ? 100 : Math.min(100, g.gradedWeight)) : 0);
      }, 0) / semCredits
    : 0;
  const provisional = gradedShare < 99.5;

  const week = weekDates(now, settings.weekStartsOn);
  const open = data.items.filter((i) => i.status !== 'completed' && isTask(i));
  const overdue = sortByDue(open.filter((i) => isOverdue(i, now)));
  const dueThisWeek = open.filter((i) => i.dueDate && i.dueDate >= week[0] && i.dueDate <= week[6]);
  const todayItems = sortByDue(open.filter((i) => i.dueDate === today && !isOverdue(i, now)));
  const todayClasses = classesOn(today, data.courses, data.semesters);
  const upcomingList = upcoming(data.items, 14, now).filter((i) => i.dueDate !== today).slice(0, 7);
  const exams = upcoming(data.items, 60, now).filter((i) => i.kind === 'exam').slice(0, 4);
  // Recently submitted or due work (not future deadlines, not participation marks).
  const recentKey = (i: (typeof data.items)[number]) => i.completedAt ?? dueMoment(i)?.toISOString() ?? i.updatedAt;
  const recent = data.items
    .filter((i) => i.kind !== 'personal' && isTask(i) && (i.status === 'completed' || (i.dueDate !== null && i.dueDate <= today)))
    .sort((a, b) => (recentKey(a) < recentKey(b) ? 1 : -1))
    .slice(0, 5);

  // Weekly workload
  const workload = week.map((date) => {
    const due = data.items.filter((i) => i.dueDate === date);
    const classMin = classesOn(date, data.courses, data.semesters).reduce((s, o) => s + occurrenceMinutes(o), 0);
    return { label: formatDate.weekday(date), date, deadlines: due.length, classHours: classMin / 60 };
  });
  const classHours = workload.reduce((s, d) => s + d.classHours, 0);
  const estHours = dueThisWeek.reduce((s, i) => s + (i.estimatedHours ?? 0), 0);
  const examsThisWeek = dueThisWeek.filter((i) => i.kind === 'exam').length;

  const isEmpty = data.courses.length === 0 && data.items.length === 0;

  return (
    <div className="page">
      <PageHeader
        title={greeting()}
        subtitle={formatDate.long(today)}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openItem(null, { dueDate: today })} data-testid="dash-new-item">
            New task
          </Button>
        }
      />

      <QuickAdd />
      <DeadlineList />

      {isEmpty || data.courses.length === 0 || !data.items.some((i) => i.score !== null) ? <Onboarding /> : null}

      <section className="card semester-card" data-testid="semester-card">
        <div className="semester-main">
          <span className="kicker">Current semester</span>
          {semester ? (
            <>
              <button className="semester-name" onClick={openSemesters} title="Manage semesters">
                {semester.name}
              </button>
              <span className="semester-meta">
                {progress
                  ? progress.status === 'active'
                    ? `Week ${progress.week} of ${progress.weeks} · ends ${formatDate.medium(semester.endDate!)}`
                    : progress.status === 'upcoming'
                      ? `Starts ${formatDate.medium(semester.startDate!)} · ${diffDays(today, semester.startDate!)} days to go`
                      : `Finished ${formatDate.medium(semester.endDate!)}`
                  : 'Add start and end dates to track your progress'}
              </span>
            </>
          ) : (
            <>
              <span className="semester-name is-empty">No semester yet</span>
              <span className="semester-meta">Create one when you add your first course.</span>
            </>
          )}
          {progress && (
            <div className="meter meter-lg" aria-label={`${Math.round(progress.fraction * 100)}% of the semester done`}>
              <div className="meter-fill" style={{ width: `${progress.fraction * 100}%` }} />
            </div>
          )}
        </div>
        <div className="semester-side">
          <div>
            <span className="semester-side-value">{semCourses.length}</span>
            <span className="semester-side-label">Courses</span>
          </div>
          <div>
            <span className="semester-side-value">{formatNumber(semCourses.reduce((s, c) => s + c.credits, 0), 1)}</span>
            <span className="semester-side-label">Credits</span>
          </div>
          <div>
            <span className="semester-side-value">{open.length}</span>
            <span className="semester-side-label">Open tasks</span>
          </div>
          <Button variant="ghost" size="sm" onClick={openSemesters}>
            Manage
          </Button>
        </div>
      </section>

      <div className="stat-grid">
        <StatTile
          label={cumulative.gpa !== null ? 'GPA' : 'GPA (this semester)'}
          value={<span data-testid="gpa-value">{formatGpa(cumulative.gpa ?? gpa.gpa, settings.gpaScale)}</span>}
          unit={(cumulative.gpa ?? gpa.gpa) !== null && settings.gpaScale !== 'hundred' ? `/ ${GPA_MAX[settings.gpaScale]}` : undefined}
          icon={<GraduationCap size={16} />}
          sub={
            cumulative.gpa === null
              ? gpa.gpa !== null
                ? `Provisional · ${formatNumber(gradedShare, 0)}% graded`
                : 'Enter grades to calculate'
              : gpa.gpa !== null && provisional
                ? `This semester ${formatGpa(gpa.gpa, settings.gpaScale)} · provisional (${formatNumber(gradedShare, 0)}% graded)`
                : `${formatNumber(cumulative.gradedCredits, 1)} credits with final grades`
          }
        />
        <StatTile
          label="Average grade"
          value={<span data-testid="avg-value">{formatGrade(avg, settings.gradeScale)}</span>}
          unit={avg !== null && settings.gradeScale !== 'hundred' ? `/ ${settings.gradeScale === 'ten' ? 10 : 20}` : undefined}
          icon={<TrendingUp size={16} />}
          sub={avg !== null ? `This semester · ${gradedCourses} of ${semCourses.length} courses graded${provisional ? ' so far' : ''}` : 'No grades yet this semester'}
        />
        <StatTile
          label="Attendance"
          value={attendance === null ? '—' : `${formatNumber(attendance, 0)}%`}
          icon={<UserCheck size={16} />}
          progress={attendance === null ? undefined : attendance / 100}
          sub={attendance === null ? 'Not tracked yet' : attendance + 1e-9 < settings.minAttendance ? `Below the ${settings.minAttendance}% minimum` : `Minimum ${settings.minAttendance}%`}
        />
        <StatTile
          label="Due this week"
          value={dueThisWeek.length}
          icon={<CalendarClock size={16} />}
          sub={overdue.length ? <span className="text-danger">{plural(overdue.length, 'overdue task')}</span> : examsThisWeek ? plural(examsThisWeek, 'exam') : 'Nothing overdue'}
        />
      </div>

      <div className="grid-2">
        <Card
          title="Today"
          subtitle={`${plural(todayClasses.length, 'class', 'classes')} · ${plural(todayItems.length + overdue.length, 'task')}`}
          action={
            <Button variant="ghost" size="sm" iconRight={<ArrowRight size={14} />} onClick={() => navigate({ name: 'calendar', date: today })}>
              Calendar
            </Button>
          }
        >
          {todayClasses.length === 0 && todayItems.length === 0 && overdue.length === 0 ? (
            <EmptyState compact icon={<Circle size={20} />} title="Nothing scheduled today" description="No classes or deadlines — a good day to get ahead." />
          ) : (
            <div className="today-list" data-testid="today-list">
              {todayClasses.length > 0 && (
                <div className="timeline">
                  {todayClasses.map((o) => {
                    const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                    const past = !!o.end && o.end <= nowHM;
                    return (
                      <button key={o.key} className={`timeline-item ${past ? 'is-past' : ''}`} onClick={() => navigate({ name: 'course', id: o.course.id })}>
                        <span className="timeline-time">
                          {o.start ?? 'Async'}
                          {o.end && <span>{o.end}</span>}
                        </span>
                        <span className="timeline-bar" style={{ background: courseColor(o.course.color) }} />
                        <span className="timeline-body">
                          <span className="timeline-title">{o.course.name}</span>
                          <span className="timeline-meta">
                            <span>{o.label}</span>
                            {o.title && <span className="timeline-topic"> · {o.title}</span>}
                            {o.room && !o.async && (
                              <>
                                {' · '}
                                <MapPin size={11} /> {o.room}
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {overdue.length > 0 && (
                <div className="list-section">
                  <div className="list-label text-danger">Overdue</div>
                  {overdue.slice(0, 4).map((i) => (
                    <ItemRow key={i.id} item={i} compact />
                  ))}
                </div>
              )}
              {todayItems.length > 0 && (
                <div className="list-section">
                  <div className="list-label">Due today</div>
                  {todayItems.map((i) => (
                    <ItemRow key={i.id} item={i} compact />
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        <Card
          title="Upcoming deadlines"
          subtitle="Next 14 days"
          action={
            <Button variant="ghost" size="sm" iconRight={<ArrowRight size={14} />} onClick={() => navigate({ name: 'assignments' })}>
              All tasks
            </Button>
          }
        >
          {upcomingList.length === 0 ? (
            <EmptyState compact icon={<CalendarDays size={20} />} title="No upcoming deadlines" description="Deadlines for the next two weeks show up here." action={<Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => openItem()}>Add deadline</Button>} />
          ) : (
            <div className="list-flush" data-testid="upcoming-list">
              {upcomingList.map((i) => (
                <ItemRow key={i.id} item={i} compact />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Upcoming exams" subtitle="Next 60 days">
          {exams.length === 0 ? (
            <EmptyState compact icon={<GraduationCap size={20} />} title="No exams scheduled" description="Add exam dates to count down to them." action={<Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => openItem(null, { kind: 'exam' })}>Add exam</Button>} />
          ) : (
            <ul className="exam-list" data-testid="exam-list">
              {exams.map((e) => {
                const days = diffDays(today, e.dueDate!);
                const course = data.courses.find((c) => c.id === e.courseId);
                return (
                  <li key={e.id}>
                    <button className="exam-row" onClick={() => openItem(e)}>
                      <span className={`exam-count ${days <= 3 ? 'is-soon' : ''}`}>
                        <span className="exam-days">{days}</span>
                        <span className="exam-days-label">{days === 1 ? 'day' : 'days'}</span>
                      </span>
                      <span className="exam-body">
                        <span className="exam-title">{e.title}</span>
                        <span className="exam-meta">
                          <CourseTag course={course} /> · {formatDate.long(e.dueDate!)}
                          {e.dueTime ? ` · ${e.dueTime}` : ''}
                          {e.weight ? ` · ${formatNumber(e.weight, 1)}% of grade` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Recent assignments" subtitle="Latest activity">
          {recent.length === 0 ? (
            <EmptyState compact icon={<ClipboardCheck size={20} />} title="Nothing submitted yet" description="Assignments you complete or that are past their deadline show up here." />
          ) : (
            <ul className="recent-list">
              {recent.map((i) => {
                const course = data.courses.find((c) => c.id === i.courseId);
                return (
                  <li key={i.id}>
                    <button className="recent-row" onClick={() => openItem(i)}>
                      <span className="recent-body">
                        <span className="recent-title">{i.title}</span>
                        <span className="recent-meta">
                          <CourseTag course={course} compact /> {course ? '· ' : ''}
                          {i.status === 'completed' && i.completedAt ? `done ${relativeDay(i.completedAt.slice(0, 10)).toLowerCase()}` : i.dueDate ? `due ${relativeDay(i.dueDate).toLowerCase()}` : ''}
                        </span>
                      </span>
                      <StatusPill status={i.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Weekly workload" subtitle={`${formatDate.short(week[0])} – ${formatDate.short(week[6])}`}>
          <div className="workload-summary">
            <div>
              <span className="workload-value">{formatHours(classHours)}</span>
              <span className="workload-label">Classes</span>
            </div>
            <div>
              <span className="workload-value">{dueThisWeek.length}</span>
              <span className="workload-label">Deadlines</span>
            </div>
            <div>
              <span className="workload-value">{examsThisWeek}</span>
              <span className="workload-label">Exams</span>
            </div>
            <div>
              <span className="workload-value">{estHours ? formatHours(estHours) : '—'}</span>
              <span className="workload-label">Est. work</span>
            </div>
          </div>
          <div className="chart-title-sm">Deadlines per day</div>
          <SimpleBarChart
            data={workload}
            xKey="label"
            yKey="deadlines"
            name="Deadlines"
            height={150}
            allowDecimals={false}
            tickFormat={(v) => String(v)}
            format={(v) => `${v} deadline${v === 1 ? '' : 's'}`}
            labelOf={(r) => `${formatDate.long(String(r.date))} · ${formatHours(Number(r.classHours))} of class`}
          />
        </Card>

        <Card
          title="Courses"
          subtitle={semester?.name ?? 'All courses'}
          action={
            <Button variant="ghost" size="sm" iconRight={<ArrowRight size={14} />} onClick={() => navigate({ name: 'grades' })}>
              Grades
            </Button>
          }
        >
          {semCourses.length === 0 ? (
            <EmptyState compact icon={<BookOpen size={20} />} title="No courses yet" description="Add your courses to track grades and schedule." />
          ) : (
            <ul className="course-snap" data-testid="course-snap">
              {semCourses.map((c) => {
                const g = courseGrade(c, data.items);
                const target = c.targetGrade ?? settings.defaultTargetPercent;
                const req = requiredForTarget(g, target);
                return (
                  <li key={c.id}>
                    <button className="course-snap-row" onClick={() => navigate({ name: 'course', id: c.id })}>
                      <span className="course-snap-name">
                        <span className="course-dot" style={{ background: courseColor(c.color) }} />
                        {c.name}
                      </span>
                      <span className="grade-bar" aria-hidden>
                        <span className="grade-bar-fill" style={{ width: `${Math.min(100, g.effective ?? 0)}%`, background: courseColor(c.color) }} />
                        <span className="grade-bar-target" style={{ left: `${Math.min(100, target)}%` }} title="Target" />
                      </span>
                      <span className="course-snap-grade">{formatGrade(g.effective, settings.gradeScale)}</span>
                      <span className="course-snap-need">
                        {req.status === 'reachable' && req.required !== null && g.gradedWeight > 0 ? (
                          <>
                            <Target size={12} /> need {formatGrade(req.required, settings.gradeScale)}
                          </>
                        ) : req.status === 'secured' ? (
                          <span className="text-success">Target secured</span>
                        ) : req.status === 'impossible' ? (
                          <span className="text-danger">Target out of reach</span>
                        ) : (
                          <span className="muted">{g.isOverride ? 'Final' : '—'}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <p className="footnote">{IS_EXTENSION ? 'Everything is stored on this computer' : 'Saved to your private account'} · {formatDate.medium(today)}</p>
    </div>
  );
}

