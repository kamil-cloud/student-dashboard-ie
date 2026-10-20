import { useState } from 'react';
import { Award, BookOpen, GraduationCap, Info, Plus, Target, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { StatTile } from '../components/charts';
import { courseColor } from '../components/common';
import { useEditors } from '../components/editors';
import {
  averageGrade,
  bandFor,
  CATEGORY_LABEL,
  computeGpa,
  courseGrade,
  ectsSummary,
  formatGpa,
  formatGrade,
  GPA_LABEL,
  GPA_MAX,
  isFinalGrade,
  qualification,
  requiredForTarget,
  SCALE_LABEL,
  toPoints,
} from '../lib/grades';
import { formatNumber } from '../lib/format';
import { navigate } from '../lib/router';
import { currentSemester, semesterProgress, sortSemesters } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Course } from '../lib/types';

/** Kept for the session so coming back from a course keeps the chosen semester. */
let rememberedFilter: string | null = null;

export function Grades() {
  const { data } = useStore();
  const { openCourse } = useEditors();
  const { settings } = data;
  const scale = settings.gradeScale;
  const unit = settings.creditUnit;
  const unitTitle = unit === 'ECTS' ? 'ECTS' : 'Credits';
  const cur = currentSemester(data);
  const [semId, setSemIdState] = useState<string>(() => rememberedFilter ?? cur?.id ?? 'all');
  const setSemId = (v: string) => {
    rememberedFilter = v;
    setSemIdState(v);
  };
  const semesters = sortSemesters(data.semesters).reverse();
  const filter = semId !== 'all' && semId !== 'none' && !data.semesters.some((s) => s.id === semId) ? 'all' : semId;
  const courses = data.courses
    .filter((c) => (filter === 'all' ? true : filter === 'none' ? !c.semesterId : c.semesterId === filter))
    .sort((a, b) => Number(b.countsInGpa) - Number(a.countsInGpa) || a.name.localeCompare(b.name));

  const cumulative = computeGpa(data.courses, data.items, settings, { finalOnly: true });
  const selectedGpa = computeGpa(courses, data.items, settings);
  const curCourses = cur ? data.courses.filter((c) => c.semesterId === cur.id) : [];
  const curGpa = computeGpa(curCourses, data.items, settings);
  const avg = averageGrade(filter === 'all' ? data.courses.filter((c) => isFinalGrade(courseGrade(c, data.items))) : courses, data.items);
  const ects = ectsSummary(filter === 'all' ? data.courses : courses, data.items, settings);
  const gpaUnit = settings.gpaScale !== 'hundred' ? `/ ${GPA_MAX[settings.gpaScale]}` : undefined;
  const selectedSem = data.semesters.find((s) => s.id === filter);
  const selectedFinished = selectedSem ? courses.every((c) => c.countsInGpa === false || c.outcome || isFinalGrade(courseGrade(c, data.items))) : false;

  const groups =
    filter === 'all'
      ? [
          ...semesters.map((sem) => ({ id: sem.id, label: sem.name, courses: courses.filter((c) => c.semesterId === sem.id) })),
          { id: 'none', label: 'No semester', courses: courses.filter((c) => !c.semesterId) },
        ].filter((g) => g.courses.length > 0)
      : [{ id: 'one', label: '', courses }];

  const row = (c: Course) => {
    const g = courseGrade(c, data.items);
    const final = isFinalGrade(g);
    const target = c.targetGrade ?? settings.defaultTargetPercent;
    const req = requiredForTarget(g, target);
    const band = g.effective !== null && settings.gpaScale === 'four' ? bandFor(g.effective, settings.gpaTable) : null;
    const qual = scale === 'ten' ? qualification(g.effective, c.honors) : null;
    return (
      <tr key={c.id} className="is-clickable" onClick={() => navigate({ name: 'course', id: c.id })} data-testid="grades-row">
        <td className="records-name">
          <span className="course-dot" style={{ background: courseColor(c.color) }} />
          <span className="grades-course">
            <span>{c.name}</span>
            <span className="grades-tags">
              {c.category && <span className="muted">{CATEGORY_LABEL[c.category]}</span>}
              {c.honors && <Badge tone="gold">MH</Badge>}
              {!c.countsInGpa && <Badge>Not in GPA</Badge>}
            </span>
          </span>
        </td>
        <td>{formatNumber(c.credits, 1)}</td>
        <td>{c.outcome ? 'Final' : final ? 'Final' : g.gradedWeight > 0 || g.equalWeighting ? `${formatNumber(g.gradedWeight, 0)}% graded` : 'In progress'}</td>
        <td className={`strong ${g.effective !== null && g.effective < settings.passPercent ? 'text-danger' : ''}`}>
          {c.outcome === 'pass' ? 'Pass' : c.outcome === 'fail' ? <span className="text-danger">Fail</span> : formatGrade(g.effective, scale)}
          {qual && !c.outcome && <span className="grades-qual">{qual}</span>}
        </td>
        <td>{!c.countsInGpa || g.effective === null ? '—' : band ? `${band.letter} · ${formatNumber(band.points, 1, 1)}` : formatNumber(toPoints(g.effective, settings), 2)}</td>
        <td>{final || c.outcome ? '—' : formatGrade(target, scale)}</td>
        <td>
          {final || c.outcome ? (
            <span className="muted">—</span>
          ) : req.status === 'reachable' && g.gradedWeight > 0 ? (
            <span className={(req.required ?? 0) > 85 ? 'text-warning' : ''}>
              {formatGrade(req.required, scale)} on {formatNumber(g.remainingWeight, 0)}%
            </span>
          ) : req.status === 'secured' ? (
            <span className="text-success">Secured</span>
          ) : req.status === 'impossible' ? (
            <span className="text-danger">Out of reach</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Grades"
        subtitle={`Grades on ${SCALE_LABEL[scale]} · GPA as ${GPA_LABEL[settings.gpaScale].toLowerCase()}`}
        actions={
          <select className="input select filter-select" value={filter} onChange={(e) => setSemId(e.target.value)} aria-label="Semester">
            <option value="all">All semesters</option>
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === cur?.id ? ' (current)' : ''}
              </option>
            ))}
            <option value="none">No semester</option>
          </select>
        }
      />

      <div className="stat-grid">
        {filter === 'all' ? (
          <>
            <StatTile label="Cumulative GPA" value={<span data-testid="grades-gpa">{formatGpa(cumulative.gpa, settings.gpaScale)}</span>} unit={cumulative.gpa !== null ? gpaUnit : undefined} icon={<GraduationCap size={16} />} sub={`Final grades only · ${formatNumber(cumulative.gradedCredits, 1)} ${unit}`} />
            <StatTile label={cur ? `This semester · ${cur.name}` : 'This semester'} value={formatGpa(curGpa.gpa, settings.gpaScale)} unit={curGpa.gpa !== null ? gpaUnit : undefined} icon={<TrendingUp size={16} />} sub={curGpa.gpa === null ? 'No grades yet' : `Provisional · ${formatNumber(curGpa.gradedCredits, 1)} of ${formatNumber(curGpa.credits, 1)} ${unit} with grades so far`} />
          </>
        ) : (
          <>
            <StatTile label="Semester GPA" value={<span data-testid="grades-gpa">{formatGpa(selectedGpa.gpa, settings.gpaScale)}</span>} unit={selectedGpa.gpa !== null ? gpaUnit : undefined} icon={<GraduationCap size={16} />} sub={selectedFinished ? 'Final' : `Provisional · ${formatNumber(selectedGpa.gradedCredits, 1)} of ${formatNumber(selectedGpa.credits, 1)} ${unit} with grades`} />
            <StatTile label="Cumulative GPA" value={formatGpa(cumulative.gpa, settings.gpaScale)} unit={cumulative.gpa !== null ? gpaUnit : undefined} icon={<TrendingUp size={16} />} sub={`Final grades only · ${cumulative.courses} courses`} />
          </>
        )}
        <StatTile label="Average grade" value={<span data-testid="grades-avg">{formatGrade(avg, scale)}</span>} unit={avg !== null && scale !== 'hundred' ? `/ ${scale === 'ten' ? 10 : 20}` : undefined} icon={<Target size={16} />} sub={filter === 'all' ? 'Unweighted mean of final grades' : 'Unweighted mean of course grades'} />
        <StatTile label={unitTitle} value={formatNumber(ects.passed, 1)} unit="passed" icon={<Award size={16} />} sub={ects.inProgress ? `${formatNumber(ects.inProgress, 1)} ${unit} in progress` : 'Degree subjects only'} />
      </div>

      <Card title="Course grades" subtitle="Click a course to enter grades and see what you need">
        {courses.length === 0 ? (
          <EmptyState compact icon={<BookOpen size={22} />} title="No courses here yet" action={<Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => openCourse()}>Add course</Button>} />
        ) : (
          <div className="table-wrap table-wrap-tall">
            <table className="data-table grades-table">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>{unitTitle}</th>
                  <th>Status</th>
                  <th>Grade</th>
                  <th>{settings.gpaScale === 'four' ? 'Letter · points' : 'Points'}</th>
                  <th>Target</th>
                  <th>Needed on the rest</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((grp) => {
                  const semGpa = computeGpa(grp.courses, data.items, settings);
                  const sem = data.semesters.find((s) => s.id === grp.id);
                  const active = sem ? semesterProgress(sem)?.status !== 'finished' : false;
                  return [
                    grp.label ? (
                      <tr key={`h-${grp.id}`} className="grade-sem-row">
                        <td colSpan={7}>
                          {grp.label}
                          <span>
                            {semGpa.gpa !== null ? `GPA ${formatGpa(semGpa.gpa, settings.gpaScale)}${active ? ' (provisional)' : ''} · ` : ''}
                            {formatNumber(grp.courses.filter((c) => c.countsInGpa).reduce((t, c) => t + c.credits, 0), 1)} {unit}
                          </span>
                        </td>
                      </tr>
                    ) : null,
                    ...grp.courses.map(row),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="info-note">
        <Info size={14} /> GPA = Σ(grade × {unit}) ÷ Σ {unit} over degree subjects. Supplementary training (languages, seminars, career development…) is shown but not counted. The cumulative GPA uses final grades only, like your transcript.{' '}
        {settings.gpaScale === 'four' ? 'Grade points come from the conversion table in Settings.' : ''}
      </p>
    </div>
  );
}
