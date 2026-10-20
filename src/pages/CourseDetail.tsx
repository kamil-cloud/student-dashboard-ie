import { useState, type ReactNode } from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, ChevronLeft, ExternalLink, MapPin, MoreHorizontal, Pencil, Plus, SearchX, Target, Trash2, User, UserCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, IconButton, Menu } from '../components/ui';
import { NumberField } from '../components/NumberField';
import { StatTile } from '../components/charts';
import { courseColor, KindIcon } from '../components/common';
import { useEditors } from '../components/editors';
import { ItemRow } from '../components/ItemRow';
import { useConfirm } from '../components/feedback';
import { attendanceStats } from '../lib/attendance';
import { formatDate, isValidDateStr, todayStr } from '../lib/dates';
import { KIND_LABEL, uid } from '../lib/defaults';
import { bandFor, CATEGORY_LABEL, courseGrade, formatGrade, fromScale, itemPercent, qualification, requiredForTarget, SCALE_MAX, toScale } from '../lib/grades';
import { formatNumber, inputNumber, plural, round } from '../lib/format';
import { LIMITS, parseNumber } from '../lib/parse';
import { navigate } from '../lib/router';
import { dueLabel, sortByDue, timeToMinutes, WEEKDAY_SHORT } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { AttendanceStatus, Course, Item } from '../lib/types';

const fmtNum = (v: number | null) => inputNumber(v);
const ATTENDANCE_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'excused', label: 'Excused' },
];

function GradeRow({ item }: { item: Item }) {
  const { data, updateItem } = useStore();
  const { openItem } = useEditors();
  const scale = data.settings.gradeScale;
  const scaleMax = SCALE_MAX[scale];
  const pct = itemPercent(item);
  const max = item.maxScore ?? scaleMax;
  return (
    <div className="grade-row" data-testid="grade-row">
      <button className="grade-title" onClick={() => openItem(item)}>
        <KindIcon kind={item.kind} />
        <span className="grade-title-text">
          <span>{item.title}</span>
          <span className="grade-sub">
            {KIND_LABEL[item.kind]}
            {item.dueDate ? ` · ${formatDate.short(item.dueDate)}` : ''}
          </span>
        </span>
      </button>
      <NumberField
        className="grade-input"
        value={item.weight}
        ariaLabel={`${item.title} weight`}
        placeholder="—"
        parse={(raw) => parseNumber(raw, { label: 'Weight', max: 100 })}
        format={fmtNum}
        onCommit={(v) => updateItem(item.id, (i) => void (i.weight = v))}
      />
      <NumberField
        className="grade-input"
        value={item.score}
        ariaLabel={`${item.title} score`}
        placeholder="—"
        parse={(raw) => parseNumber(raw, { label: 'Score', max })}
        format={fmtNum}
        onCommit={(v) =>
          updateItem(item.id, (i) => {
            if (v !== null && i.score === null && i.status !== 'completed') {
              i.status = 'completed';
              i.completedAt = new Date().toISOString();
            }
            i.score = v;
            if (v !== null && i.maxScore === null) i.maxScore = scaleMax;
          })
        }
      />
      <NumberField
        className="grade-input"
        value={item.maxScore}
        ariaLabel={`${item.title} out of`}
        placeholder={String(scaleMax)}
        parse={(raw) => {
          const r = parseNumber(raw, { label: 'Out of', max: LIMITS.maxScore, min: 0.01 });
          if (r.ok && r.value !== null && item.score !== null && item.score > r.value) return { ok: false, error: `Must be at least the score (${item.score})` };
          return r;
        }}
        format={fmtNum}
        onCommit={(v) => updateItem(item.id, (i) => void (i.maxScore = v))}
      />
      <span className={`grade-result ${pct === null ? 'muted' : ''}`}>{pct === null ? '—' : formatGrade(pct, scale)}</span>
      <span className="grade-contrib muted small">{pct !== null && item.weight ? `+${formatNumber((item.weight * pct) / 100, 1)} pts` : ''}</span>
    </div>
  );
}

function TargetCard({ course }: { course: Course }) {
  const { data, updateCourse } = useStore();
  const { settings } = data;
  const scale = settings.gradeScale;
  const g = courseGrade(course, data.items);
  const target = course.targetGrade ?? settings.defaultTargetPercent;
  const req = requiredForTarget(g, target);
  const remaining = formatNumber(g.remainingWeight, 1);

  let message: ReactNode;
  let tone = 'neutral';
  if (req.status === 'final') {
    message = g.isOverride ? <>A final grade of <strong>{formatGrade(g.effective, scale, true)}</strong> is entered for this course.</> : <>All weighted work is graded — you finished at <strong>{formatGrade(g.current, scale, true)}</strong>, below the target.</>;
    tone = g.isOverride ? 'neutral' : 'danger';
  } else if (req.status === 'unknown') {
    message = 'Add a weight to each assessment to calculate the grade you need.';
  } else if (g.gradedWeight <= 0) {
    message = (
      <>
        Enter your first grades to see what you need. With nothing graded yet, you need an average of <strong>{formatGrade(target, scale, true)}</strong>.
      </>
    );
  } else if (req.status === 'secured') {
    message = (
      <>
        Target secured — even scoring 0 on the remaining {remaining}% leaves you at <strong>{formatGrade(g.minPossible, scale, true)}</strong>.
      </>
    );
    tone = 'success';
  } else if (req.status === 'impossible') {
    message = (
      <>
        Out of reach — even full marks on the remaining {remaining}% gives <strong>{formatGrade(g.maxPossible, scale, true)}</strong> at most.
      </>
    );
    tone = 'danger';
  } else {
    message = (
      <>
        You need an average of <strong data-testid="required-grade">{formatGrade(req.required, scale, true)}</strong> on the remaining <strong>{remaining}%</strong> to finish with {formatGrade(target, scale, true)}.
      </>
    );
    tone = (req.required ?? 0) > 85 ? 'warning' : 'accent';
  }

  const min = g.minPossible;
  const max = g.maxPossible;
  return (
    <Card title="Target grade" subtitle="What you need on the rest of the course">
      <div className="target-row">
        <label className="target-input">
          <span className="field-sublabel">Target</span>
          <NumberField
            value={round(toScale(target, scale), 2)}
            ariaLabel="Target grade"
            parse={(raw) => {
              const r = parseNumber(raw, { label: 'Target', max: SCALE_MAX[scale] });
              return r.ok && r.value === null ? { ok: false, error: 'Enter a target' } : r;
            }}
            format={fmtNum}
            onCommit={(v) => v !== null && updateCourse(course.id, (c) => void (c.targetGrade = fromScale(v, scale)))}
          />
          <span className="muted small">/ {SCALE_MAX[scale]}</span>
        </label>
        <p className={`target-message tone-${tone}`} data-testid="target-message">
          {message}
        </p>
      </div>
      {min !== null && max !== null && (
        <div className="range">
          <div className="range-track">
            <span className="range-fill" style={{ left: `${min}%`, width: `${Math.max(0.5, max - min)}%` }} />
            {g.current !== null && <span className="range-current" style={{ left: `${Math.min(100, g.current)}%` }} title="Current average" />}
            <span className="range-target" style={{ left: `${Math.min(100, target)}%` }} title="Target" />
          </div>
          <div className="range-labels">
            <span>
              Worst case <strong>{formatGrade(min, scale)}</strong>
            </span>
            <span>
              Current <strong>{formatGrade(g.current, scale)}</strong>
            </span>
            <span>
              Best case <strong>{formatGrade(max, scale)}</strong>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function AttendanceCard({ course }: { course: Course }) {
  const { data, updateCourse } = useStore();
  const confirm = useConfirm();
  const [date, setDate] = useState(todayStr());
  const min = data.settings.minAttendance;
  const s = attendanceStats(course, min);
  const records = [...course.attendance].sort((a, b) => (a.date < b.date ? 1 : -1));

  const mark = (status: AttendanceStatus) => {
    if (!isValidDateStr(date)) return;
    updateCourse(course.id, (c) => {
      const existing = c.attendance.find((r) => r.date === date);
      if (existing) existing.status = status;
      else c.attendance.push({ id: uid(), date, status });
    });
  };

  return (
    <Card title="Attendance" subtitle={`Minimum ${min}% required`}>
      <div className="att-summary">
        <div className="att-rate">
          <span className={`att-rate-value ${s.belowMinimum ? 'text-danger' : ''}`} data-testid="attendance-rate">
            {s.rate === null ? '—' : `${formatNumber(s.rate, 0)}%`}
          </span>
          <span className="muted small">{s.recorded ? `${plural(s.recorded, 'session')} recorded` : 'No sessions recorded'}</span>
        </div>
        <div className="att-counts">
          <span>
            <b>{s.present}</b> present
          </span>
          <span>
            <b>{s.late}</b> late
          </span>
          <span>
            <b>{s.absent}</b> absent
          </span>
          <span>
            <b>{s.excused}</b> excused
          </span>
        </div>
      </div>
      {s.remainingAbsences !== null && (
        <p className={`att-note ${s.remainingAbsences < 0 ? 'text-danger' : s.remainingAbsences <= 1 ? 'text-warning' : ''}`}>
          {s.remainingAbsences < 0 ? (
            <>
              <AlertTriangle size={14} /> {plural(-s.remainingAbsences, 'absence')} over the limit of {s.maxAbsences}.
            </>
          ) : (
            <>You can miss {plural(s.remainingAbsences, 'more class', 'more classes')} (limit {s.maxAbsences} of {course.totalSessions}).</>
          )}
        </p>
      )}
      {s.belowMinimum && s.remainingAbsences === null && (
        <p className="att-note text-danger">
          <AlertTriangle size={14} /> Below the {min}% minimum.
        </p>
      )}
      <div className="att-mark">
        <input type="date" className="input att-date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Attendance date" />
        {ATTENDANCE_OPTIONS.map((o) => (
          <Button key={o.value} variant="secondary" size="sm" className={`att-btn att-${o.value}`} onClick={() => mark(o.value)} disabled={!isValidDateStr(date)}>
            {o.label}
          </Button>
        ))}
      </div>
      {records.length > 0 && (
        <ul className="att-list">
          {records.slice(0, 8).map((r) => (
            <li key={r.id} className="att-item">
              <span>{formatDate.medium(r.date)}</span>
              <select
                className="input select att-select"
                value={r.status}
                aria-label={`Attendance on ${formatDate.medium(r.date)}`}
                onChange={(e) => updateCourse(course.id, (c) => void (c.attendance.find((x) => x.id === r.id)!.status = e.target.value as AttendanceStatus))}
              >
                {ATTENDANCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <IconButton
                label={`Remove attendance on ${formatDate.medium(r.date)}`}
                size="sm"
                tone="danger"
                onClick={async () => {
                  const ok = await confirm({ title: 'Remove this attendance record?', message: `${formatDate.long(r.date)} (${r.status}).`, confirmLabel: 'Remove', tone: 'danger' });
                  if (ok) updateCourse(course.id, (c) => void (c.attendance = c.attendance.filter((x) => x.id !== r.id)));
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
          {records.length > 8 && <li className="muted small att-more">+{records.length - 8} earlier records</li>}
        </ul>
      )}
    </Card>
  );
}

function SessionList({ course }: { course: Course }) {
  const [showAll, setShowAll] = useState(false);
  const today = todayStr();
  const sorted = [...course.sessions].sort((a, b) => (a.date + (a.start ?? '') < b.date + (b.start ?? '') ? -1 : 1));
  const upcomingSessions = sorted.filter((s) => s.date >= today);
  const list = showAll ? sorted : upcomingSessions.slice(0, 6);
  return (
    <>
      <p className="muted small session-summary">
        {course.sessions.length - upcomingSessions.length} of {course.sessions.length} sessions done · {course.sessions.filter((s) => s.mode === 'async').length} asynchronous
      </p>
      <ul className="session-list">
        {list.map((s) => (
          <li key={s.id} className={s.date < today ? 'is-past' : ''}>
            <span className="session-date">
              {formatDate.weekday(s.date)} {formatDate.short(s.date)}
            </span>
            <span className="session-time">{s.start ? `${s.start}–${s.end}` : 'Async'}</span>
            <span className="session-title">{s.title || (s.mode === 'online' ? 'Live online' : s.mode === 'async' ? 'Asynchronous' : 'In person')}</span>
            <span className="session-room muted">{s.mode === 'async' ? '' : s.room}</span>
          </li>
        ))}
      </ul>
      {sorted.length > 6 && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show upcoming only' : `Show all ${sorted.length} sessions`}
        </Button>
      )}
    </>
  );
}

export function CourseDetail({ id }: { id: string }) {
  const { data, updateCourse } = useStore();
  const { openCourse, openItem, deleteCourse } = useEditors();
  const course = data.courses.find((c) => c.id === id);

  if (!course) {
    return (
      <div className="page">
        <EmptyState icon={<SearchX size={26} />} title="Course not found" description="It may have been deleted." action={<Button variant="primary" onClick={() => navigate({ name: 'courses' })}>Back to courses</Button>} />
      </div>
    );
  }

  const { settings } = data;
  const scale = settings.gradeScale;
  const g = courseGrade(course, data.items);
  const target = course.targetGrade ?? settings.defaultTargetPercent;
  const req = requiredForTarget(g, target);
  const att = attendanceStats(course, settings.minAttendance);
  const items = data.items.filter((i) => i.courseId === course.id);
  const assessments = sortByDue(items.filter((i) => i.kind !== 'personal'));
  const open = sortByDue(items.filter((i) => i.status !== 'completed'));
  const done = items.filter((i) => i.status === 'completed').length;
  const sem = data.semesters.find((s) => s.id === course.semesterId);
  const band = g.effective !== null && settings.gpaScale === 'four' ? bandFor(g.effective, settings.gpaTable) : null;
  const nextDue = open.find((i) => i.dueDate);

  return (
    <div className="page" style={{ ['--course' as string]: courseColor(course.color) }}>
      <div className="editor-topbar">
        <button className="back-link" onClick={() => navigate({ name: 'courses' })}>
          <ChevronLeft size={16} /> Courses
        </button>
        <div className="editor-actions">
          <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => openCourse(course)} data-testid="edit-course">
            Edit
          </Button>
          <Menu label="More course actions" items={[{ label: 'Delete course', icon: <Trash2 size={15} />, danger: true, onSelect: () => void deleteCourse(course, () => navigate({ name: 'courses' }, { replace: true })) }]}>
            <MoreHorizontal size={18} />
          </Menu>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openItem(null, { courseId: course.id, kind: 'exam' })} data-testid="add-assessment">
            Add assessment
          </Button>
        </div>
      </div>

      <header className="course-hero">
        <span className="course-hero-bar" />
        <div>
          <h1 className="page-title">{course.name}</h1>
          <p className="course-hero-meta">
            {[course.code, sem?.name, `${formatNumber(course.credits, 1)} ${data.settings.creditUnit}`, course.category ? CATEGORY_LABEL[course.category] : null].filter(Boolean).join(' · ')}
            {!course.countsInGpa && <Badge>Not in GPA</Badge>}
            {course.honors && <Badge tone="gold">Matrícula de Honor</Badge>}
            {course.professor && (
              <span>
                <User size={13} /> {course.professor}
              </span>
            )}
            {course.room && (
              <span>
                <MapPin size={13} /> {course.room}
              </span>
            )}
            {course.sources.blackboard && data.blackboard.host && (
              <a className="hero-link" href={`${data.blackboard.host}/ultra/courses/${encodeURIComponent(course.sources.blackboard.id.replace(/^bb:course:/, ''))}/outline`} target="_blank" rel="noreferrer" data-testid="open-in-bb">
                <ExternalLink size={13} /> Blackboard
              </a>
            )}
          </p>
        </div>
      </header>

      <div className="stat-grid">
        <StatTile
          label={g.isOverride || course.outcome ? 'Final grade' : 'Current grade'}
          value={<span data-testid="course-grade">{course.outcome === 'pass' ? 'Pass' : course.outcome === 'fail' ? 'Fail' : formatGrade(g.effective, scale)}</span>}
          unit={!course.outcome && g.effective !== null && scale !== 'hundred' ? `/ ${SCALE_MAX[scale]}` : undefined}
          sub={
            course.outcome
              ? course.outcome === 'pass'
                ? 'Apto'
                : 'No apto'
              : g.effective === null
                ? 'No grades yet'
                : g.isOverride
                  ? [scale === 'ten' ? qualification(g.effective, course.honors) : null, band?.letter].filter(Boolean).join(' · ') || 'Final grade'
                  : `${formatNumber(g.gradedWeight, 0)}% of the course graded${band ? ` · ${band.letter}` : ''}`
          }
        />
        <StatTile
          label="Target"
          value={formatGrade(target, scale)}
          icon={<Target size={16} />}
          sub={
            req.status === 'reachable' && g.gradedWeight > 0
              ? `Need ${formatGrade(req.required, scale)} on the rest`
              : req.status === 'reachable'
                ? `Average ${formatGrade(target, scale)} needed on everything`
                : req.status === 'secured'
                  ? 'Secured'
                  : req.status === 'impossible'
                    ? 'Out of reach'
                    : g.isOverride
                      ? 'Final grade entered'
                      : '—'
          }
        />
        <StatTile label="Attendance" value={att.rate === null ? '—' : `${formatNumber(att.rate, 0)}%`} icon={<UserCheck size={16} />} sub={att.recorded ? (att.remainingAbsences !== null ? `${Math.max(0, att.remainingAbsences)} absences left` : `${att.absent} absences`) : 'Not tracked yet'} />
        <StatTile label="Tasks" value={open.length} unit="open" sub={nextDue ? `Next: ${nextDue.title} · ${dueLabel(nextDue).text}` : `${done} completed`} />
      </div>

      <Card
        title="Grade breakdown"
        subtitle="Edit weights and scores directly — the course grade updates instantly"
        action={
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => openItem(null, { courseId: course.id, kind: 'assignment' })}>
            Add
          </Button>
        }
      >
        {assessments.length === 0 ? (
          <EmptyState
            compact
            icon={<Target size={22} />}
            title="No assessments yet"
            description="Add exams, assignments, projects and participation with their weight (e.g. Midterm 30%, Final 40%)."
            action={
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => openItem(null, { courseId: course.id, kind: 'exam' })}>
                Add assessment
              </Button>
            }
          />
        ) : (
          <>
            <div className="grade-table" role="table" aria-label="Grade breakdown">
              <div className="grade-row grade-head" role="row">
                <span>Assessment</span>
                <span>Weight %</span>
                <span>Score</span>
                <span>Out of</span>
                <span>Grade</span>
                <span />
              </div>
              {assessments.map((i) => (
                <GradeRow key={i.id} item={i} />
              ))}
              <div className="grade-row grade-foot">
                <span>
                  Total weight <strong>{formatNumber(g.enteredWeight, 1)}%</strong> · graded <strong>{formatNumber(g.gradedWeight, 1)}%</strong>
                </span>
                <span className="grade-result">
                  <strong>{formatGrade(g.current, scale)}</strong>
                </span>
                <span />
              </div>
            </div>
            {g.warning && (
              <p className="warning-note">
                <AlertTriangle size={14} /> {g.warning}
              </p>
            )}
            {g.isOverride && (
              <p className="info-note">
                A final grade of {formatGrade(g.effective, scale, true)} is set in the course settings and is used for your GPA instead of the calculated {formatGrade(g.current, scale)}.
              </p>
            )}
          </>
        )}
      </Card>

      <div className="grid-2">
        <TargetCard course={course} />
        <AttendanceCard course={course} />
      </div>

      <div className="grid-2">
        <Card
          title="Upcoming work"
          subtitle={`${open.length} open · ${done} completed`}
          action={
            <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={() => openItem(null, { courseId: course.id })}>
              Add
            </Button>
          }
        >
          {open.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 size={22} />} title="Nothing open for this course" description="Assignments and exams for this course appear here." />
          ) : (
            <div className="list-flush">
              {open.slice(0, 8).map((i) => (
                <ItemRow key={i.id} item={i} showCourse={false} compact />
              ))}
            </div>
          )}
        </Card>
        <Card
          title="Schedule"
          action={
            <Button variant="ghost" size="sm" icon={<Pencil size={14} />} onClick={() => openCourse(course)}>
              Edit
            </Button>
          }
        >
          {course.sessions.length > 0 ? (
            <SessionList course={course} />
          ) : course.schedule.length === 0 ? (
            <EmptyState compact icon={<CalendarRange size={22} />} title="No class times" description="Add your weekly class times to see them in the calendar." />
          ) : (
            <ul className="slot-list">
              {[...course.schedule]
                .sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || timeToMinutes(a.start) - timeToMinutes(b.start))
                .map((s) => (
                  <li key={s.id}>
                    <span className="slot-day">{WEEKDAY_SHORT[s.day]}</span>
                    <span className="slot-time">
                      {s.start} – {s.end}
                    </span>
                    <Badge>{s.type}</Badge>
                    <span className="slot-room muted">
                      {(s.room || course.room) && (
                        <>
                          <MapPin size={12} /> {s.room || course.room}
                        </>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Notes" subtitle="Saved automatically">
        <textarea
          className="input textarea notes-area"
          value={course.notes}
          maxLength={LIMITS.notesLength}
          placeholder="Office hours, syllabus rules, exam topics…"
          aria-label="Course notes"
          onChange={(e) => updateCourse(course.id, (c) => void (c.notes = e.target.value))}
        />
      </Card>
    </div>
  );
}
