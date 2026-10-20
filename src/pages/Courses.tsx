import { useMemo, useState } from 'react';
import { BookOpen, CalendarRange, MapPin, Plus, User } from 'lucide-react';
import { Badge, Button, EmptyState, PageHeader } from '../components/ui';
import { courseColor } from '../components/common';
import { useEditors } from '../components/editors';
import { attendanceStats } from '../lib/attendance';
import { formatDate } from '../lib/dates';
import { CATEGORY_LABEL, courseGrade, formatGrade, isFinalGrade, qualification } from '../lib/grades';
import { formatNumber, plural } from '../lib/format';
import { navigate } from '../lib/router';
import { courseScheduleText, currentSemester, dueLabel, sortSemesters, upcoming } from '../lib/schedule';
import { useStore } from '../lib/store';

/** Kept for the session so coming back from a course keeps the chosen semester. */
let rememberedFilter: string | null = null;

export function Courses() {
  const { data } = useStore();
  const { openCourse, openSemesters } = useEditors();
  const cur = currentSemester(data);
  const [semFilter, setSemFilterState] = useState<string>(() => rememberedFilter ?? cur?.id ?? 'all');
  const setSemFilter = (v: string) => {
    rememberedFilter = v;
    setSemFilterState(v);
  };
  const semesters = sortSemesters(data.semesters).reverse();
  const effectiveFilter = semFilter !== 'all' && semFilter !== 'none' && !data.semesters.some((s) => s.id === semFilter) ? 'all' : semFilter;

  const courses = useMemo(
    () =>
      data.courses
        .filter((c) => (effectiveFilter === 'all' ? true : effectiveFilter === 'none' ? !c.semesterId : c.semesterId === effectiveFilter))
        .sort((a, b) => Number(b.countsInGpa) - Number(a.countsInGpa) || a.name.localeCompare(b.name)),
    [data.courses, effectiveFilter],
  );
  const groups =
    effectiveFilter === 'all'
      ? [
          ...semesters.map((sem) => ({ id: sem.id, label: sem.name, courses: courses.filter((c) => c.semesterId === sem.id) })),
          { id: 'none', label: 'No semester', courses: courses.filter((c) => !c.semesterId) },
        ].filter((g) => g.courses.length > 0)
      : [{ id: 'one', label: '', courses }];
  const next = upcoming(data.items, 365);
  const scale = data.settings.gradeScale;
  const credits = courses.filter((c) => c.countsInGpa).reduce((s, c) => s + c.credits, 0);

  return (
    <div className="page">
      <PageHeader
        title="Courses"
        subtitle={`${plural(courses.length, 'course')} · ${formatNumber(credits, 1)} ${data.settings.creditUnit}`}
        actions={
          <>
            <select className="input select filter-select" value={effectiveFilter} onChange={(e) => setSemFilter(e.target.value)} aria-label="Semester">
              <option value="all">All semesters</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === cur?.id ? ' (current)' : ''}
                </option>
              ))}
              <option value="none">No semester</option>
            </select>
            <Button variant="secondary" icon={<CalendarRange size={16} />} onClick={openSemesters}>
              Semesters
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => openCourse(null, effectiveFilter !== 'all' && effectiveFilter !== 'none' ? { semesterId: effectiveFilter } : {})} data-testid="new-course">
              New course
            </Button>
          </>
        }
      />

      {courses.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<BookOpen size={26} />}
            title={data.courses.length === 0 ? 'No courses yet' : 'No courses in this semester'}
            description="Add a course with its professor, credits, schedule and room. Then record grades and deadlines for it."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => openCourse()}>
                Add a course
              </Button>
            }
          />
        </div>
      ) : (
        groups.map((grp) => (
          <section key={grp.id} className="course-group">
            {grp.label && (
              <header className="group-header">
                <h2>{grp.label}</h2>
                <span>
                  {plural(grp.courses.length, 'course')} · {formatNumber(grp.courses.filter((c) => c.countsInGpa).reduce((t, c) => t + c.credits, 0), 1)} {data.settings.creditUnit}
                </span>
              </header>
            )}
            <div className="course-grid">
              {grp.courses.map((c) => {
                const g = courseGrade(c, data.items);
                const final = isFinalGrade(g) || c.outcome !== null;
                const att = attendanceStats(c, data.settings.minAttendance);
                const nextItem = next.find((i) => i.courseId === c.id);
                const target = c.targetGrade ?? data.settings.defaultTargetPercent;
                const qual = scale === 'ten' ? qualification(g.effective, c.honors) : null;
                return (
                  <button key={c.id} className={`course-card ${final ? 'is-final' : ''}`} onClick={() => navigate({ name: 'course', id: c.id })} data-testid="course-card" style={{ ['--course' as string]: courseColor(c.color) }}>
                    <span className="course-card-bar" />
                    <span className="course-card-head">
                      <span className="course-card-name">{c.name}</span>
                      <span className="course-card-sub">
                        {[c.code, `${formatNumber(c.credits, 1)} ${data.settings.creditUnit}`, c.category ? CATEGORY_LABEL[c.category] : null].filter(Boolean).join(' · ')}
                        {!c.countsInGpa && <Badge>Not in GPA</Badge>}
                      </span>
                    </span>
                    <span className="course-card-info">
                      {c.professor && (
                        <span>
                          <User size={13} /> {c.professor}
                        </span>
                      )}
                      {!final && (
                        <span>
                          <CalendarRange size={13} /> {courseScheduleText(c)}
                        </span>
                      )}
                      {!final && c.room && (
                        <span>
                          <MapPin size={13} /> {c.room}
                        </span>
                      )}
                    </span>
                    <span className="course-card-foot">
                      <span className="course-card-grade">
                        <span className="course-card-grade-value">
                          {c.outcome === 'pass' ? 'Pass' : c.outcome === 'fail' ? 'Fail' : formatGrade(g.effective, scale)}
                          {c.honors && <Badge tone="gold">MH</Badge>}
                        </span>
                        <span className="course-card-grade-label">
                          {c.outcome === 'pass' ? 'Apto' : final ? (qual ?? 'Final grade') : g.effective === null ? 'No grades yet' : `${formatNumber(g.gradedWeight, 0)}% graded · target ${formatGrade(target, scale)}`}
                        </span>
                      </span>
                      {!final && (
                        <span className="course-card-next">
                          {nextItem ? (
                            <>
                              <span className="course-card-next-title">{nextItem.title}</span>
                              <span className={`due due-${dueLabel(nextItem).tone}`}>{dueLabel(nextItem).text}</span>
                            </>
                          ) : (
                            <span className="muted small">No upcoming deadlines</span>
                          )}
                          {att.rate !== null && <span className={`small ${att.belowMinimum ? 'text-danger' : 'muted'}`}>Attendance {formatNumber(att.rate, 0)}%</span>}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
      {courses.length > 0 && <p className="footnote">Updated {formatDate.medium(new Date().toISOString().slice(0, 10))}</p>}
    </div>
  );
}
