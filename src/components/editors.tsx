import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarPlus, Check, Plus, Star, Trash2, X } from 'lucide-react';
import { Button, IconButton, Modal, Segmented } from './ui';
import { useConfirm, useToast } from './feedback';
import { COURSE_COLORS, courseColor, KindIcon } from './common';
import { isValidDateStr, formatDate } from '../lib/dates';
import { KIND_LABEL, KIND_ORDER, newCourse, newItem, newSemester, suggestSemester, uid } from '../lib/defaults';
import { formatGrade, fromScale, itemPercent, SCALE_MAX, toScale } from '../lib/grades';
import { formatNumber, inputNumber, plural, round } from '../lib/format';
import { LIMITS, parseNumber } from '../lib/parse';
import { isValidTime, REMINDER_LABEL, sortSemesters, WEEKDAYS, currentSemester } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Course, CourseCategory, Item, ItemKind, ItemStatus, Priority, ReminderOffset, Semester, SlotType, Weekday } from '../lib/types';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface Editors {
  openItem: (item?: Item | null, defaults?: Partial<Item>) => void;
  openCourse: (course?: Course | null, defaults?: Partial<Course>) => void;
  openSemesters: () => void;
  deleteItem: (item: Item) => Promise<void>;
  deleteCourse: (course: Course, onDeleted?: () => void) => Promise<void>;
}

const EditorsContext = createContext<Editors | null>(null);

export function useEditors(): Editors {
  const ctx = useContext(EditorsContext);
  if (!ctx) throw new Error('useEditors must be used inside <EditorsProvider>');
  return ctx;
}

export function EditorsProvider({ children }: { children: ReactNode }) {
  const { data, update } = useStore();
  const confirm = useConfirm();
  const [itemState, setItemState] = useState<{ item: Item | null; defaults: Partial<Item>; n: number } | null>(null);
  const [courseState, setCourseState] = useState<{ course: Course | null; defaults: Partial<Course>; n: number } | null>(null);
  const [semestersOpen, setSemestersOpen] = useState(false);
  const counter = useRef(0);

  const openItem = useCallback((item?: Item | null, defaults: Partial<Item> = {}) => setItemState({ item: item ?? null, defaults, n: ++counter.current }), []);
  const openCourse = useCallback((course?: Course | null, defaults: Partial<Course> = {}) => setCourseState({ course: course ?? null, defaults, n: ++counter.current }), []);
  const openSemesters = useCallback(() => setSemestersOpen(true), []);

  const deleteItem = useCallback(
    async (item: Item) => {
      const ok = await confirm({
        title: `Delete this ${KIND_LABEL[item.kind].toLowerCase()}?`,
        message: `“${item.title}”${item.score !== null ? ' and its grade' : ''} will be deleted. You can undo this right after.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return;
      const idx = data.items.findIndex((i) => i.id === item.id);
      update(
        (d) => {
          d.items = d.items.filter((i) => i.id !== item.id);
        },
        {
          undo: {
            label: `“${item.title}” deleted`,
            recipe: (d) => {
              if (!d.items.some((i) => i.id === item.id)) d.items.splice(Math.min(idx, d.items.length), 0, item);
            },
          },
        },
      );
    },
    [confirm, data.items, update],
  );

  const deleteCourse = useCallback(
    async (course: Course, onDeleted?: () => void) => {
      const linked = data.items.filter((i) => i.courseId === course.id);
      const ok = await confirm({
        title: 'Delete this course?',
        message: (
          <>
            <strong>{course.name}</strong>
            {linked.length > 0 ? ` and its ${plural(linked.length, 'assignment, exam or grade', 'assignments, exams and grades')}` : ''} will be deleted, including attendance and notes. You can undo this right after.
          </>
        ),
        confirmLabel: 'Delete course',
        tone: 'danger',
      });
      if (!ok) return;
      const idx = data.courses.findIndex((c) => c.id === course.id);
      onDeleted?.();
      update(
        (d) => {
          d.courses = d.courses.filter((c) => c.id !== course.id);
          d.items = d.items.filter((i) => i.courseId !== course.id);
        },
        {
          undo: {
            label: `${course.name} deleted`,
            recipe: (d) => {
              if (!d.courses.some((c) => c.id === course.id)) d.courses.splice(Math.min(idx, d.courses.length), 0, course);
              for (const it of linked) if (!d.items.some((i) => i.id === it.id)) d.items.push(it);
            },
          },
        },
      );
    },
    [confirm, data.courses, data.items, update],
  );

  const value = useMemo(() => ({ openItem, openCourse, openSemesters, deleteItem, deleteCourse }), [openItem, openCourse, openSemesters, deleteItem, deleteCourse]);

  return (
    <EditorsContext.Provider value={value}>
      {children}
      <ItemEditor key={itemState ? `i${itemState.n}` : 'i'} state={itemState} onClose={() => setItemState(null)} />
      <CourseEditor key={courseState ? `c${courseState.n}` : 'c'} state={courseState} onClose={() => setCourseState(null)} />
      <SemesterManager open={semestersOpen} onClose={() => setSemestersOpen(false)} />
    </EditorsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function useDiscardGuard(dirty: boolean, onClose: () => void) {
  const confirm = useConfirm();
  return useCallback(async () => {
    if (dirty) {
      const ok = await confirm({ title: 'Discard your changes?', message: 'You have unsaved changes in this form.', confirmLabel: 'Discard', tone: 'danger', cancelLabel: 'Keep editing' });
      if (!ok) return;
    }
    onClose();
  }, [dirty, confirm, onClose]);
}

function FieldError({ error }: { error?: string | null }) {
  return error ? <span className="field-error">{error}</span> : null;
}

/** Numeric text input that keeps the raw text in form state (validated on save). */
function RawNumber({ value, onChange, placeholder, label, error, suffix, id }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; error?: string | null; suffix?: string; id?: string }) {
  return (
    <div className={`input-suffix ${error ? 'has-error' : ''}`}>
      <input id={id} className={`input ${error ? 'has-error' : ''}`} inputMode="decimal" value={value} placeholder={placeholder} aria-label={label} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {suffix && <span className="input-suffix-text">{suffix}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item editor
// ---------------------------------------------------------------------------

interface ItemForm {
  title: string;
  kind: ItemKind;
  courseId: string;
  dueDate: string;
  dueTime: string;
  status: ItemStatus;
  priority: Priority;
  reminder: ReminderOffset;
  estimatedHours: string;
  weight: string;
  score: string;
  maxScore: string;
  description: string;
  notes: string;
}

function toForm(item: Item): ItemForm {
  return {
    title: item.title,
    kind: item.kind,
    courseId: item.courseId ?? '',
    dueDate: item.dueDate ?? '',
    dueTime: item.dueTime ?? '',
    status: item.status,
    priority: item.priority,
    reminder: item.reminder,
    estimatedHours: inputNumber(item.estimatedHours),
    weight: inputNumber(item.weight),
    score: inputNumber(item.score),
    maxScore: inputNumber(item.maxScore),
    description: item.description,
    notes: item.notes,
  };
}

function ItemEditor({ state, onClose }: { state: { item: Item | null; defaults: Partial<Item> } | null; onClose: () => void }) {
  const { data, update } = useStore();
  const toast = useToast();
  const { settings } = data;
  const scaleMax = SCALE_MAX[settings.gradeScale];

  const initial = useMemo<ItemForm>(() => {
    if (state?.item) return toForm(state.item);
    const defaults = state?.defaults ?? {};
    const courseId = defaults.courseId && data.courses.some((c) => c.id === defaults.courseId) ? defaults.courseId : null;
    return toForm(newItem({ reminder: settings.defaultReminder, ...defaults, courseId }));
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState<ItemForm>(initial);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => setForm(initial), [initial]);

  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const requestClose = useDiscardGuard(dirty, onClose);

  // Courses: current semester first.
  const semesters = sortSemesters(data.semesters);
  const cur = currentSemester(data);
  const courseGroups = [
    ...(cur ? [{ label: cur.name, courses: data.courses.filter((c) => c.semesterId === cur.id) }] : []),
    ...semesters.filter((s) => s.id !== cur?.id).reverse().map((s) => ({ label: s.name, courses: data.courses.filter((c) => c.semesterId === s.id) })),
    { label: 'No semester', courses: data.courses.filter((c) => !c.semesterId || !data.semesters.some((s) => s.id === c.semesterId)) },
  ].filter((g) => g.courses.length > 0);

  // Validation
  const weight = parseNumber(form.weight, { label: 'Weight', max: 100 });
  const maxScore = parseNumber(form.maxScore, { label: 'Out of', max: LIMITS.maxScore });
  const score = parseNumber(form.score, { label: 'Score', max: LIMITS.maxScore });
  const hours = parseNumber(form.estimatedHours, { label: 'Hours', max: LIMITS.hours });
  const effMax = maxScore.ok ? (maxScore.value ?? scaleMax) : null;
  const errors: Partial<Record<keyof ItemForm, string>> = {};
  if (!form.title.trim()) errors.title = 'Give it a title';
  else if (form.title.trim().length > LIMITS.titleLength) errors.title = `Keep the title under ${LIMITS.titleLength} characters`;
  if (form.dueDate && !isValidDateStr(form.dueDate)) errors.dueDate = 'Enter a valid date';
  if (form.dueTime && !isValidTime(form.dueTime)) errors.dueTime = 'Enter a valid time';
  if (form.dueTime && !form.dueDate) errors.dueDate = 'Add a date for this time';
  if (!weight.ok) errors.weight = weight.error;
  if (!maxScore.ok) errors.maxScore = maxScore.error;
  else if (maxScore.value === 0) errors.maxScore = 'Must be more than 0';
  if (!score.ok) errors.score = score.error;
  else if (score.value !== null && effMax !== null && score.value > effMax) errors.score = `Score can’t be more than ${formatNumber(effMax, 2)}`;
  if (!hours.ok) errors.estimatedHours = hours.error;
  const valid = Object.keys(errors).length === 0;
  const show = (k: keyof ItemForm) => (submitted || (k !== 'title' && form[k] !== initial[k]) ? errors[k] : undefined);

  const course = data.courses.find((c) => c.id === form.courseId);
  const gradable = form.kind !== 'personal' && !!course;
  const preview = score.ok && score.value !== null && effMax ? itemPercent({ score: score.value, maxScore: effMax }) : null;

  // Weight total for this course (excluding this item).
  const otherWeight = course ? data.items.filter((i) => i.courseId === course.id && i.id !== state?.item?.id && i.kind !== 'personal').reduce((s, i) => s + (i.weight ?? 0), 0) : 0;
  const totalWeight = otherWeight + (weight.ok && weight.value ? weight.value : 0);

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    const now = new Date().toISOString();
    const hasScore = gradable && score.ok && score.value !== null;
    const patch: Partial<Item> = {
      title: form.title.trim().replace(/\s+/g, ' '),
      kind: form.kind,
      courseId: form.courseId || null,
      dueDate: form.dueDate || null,
      dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
      status: form.status,
      priority: form.priority,
      reminder: form.reminder,
      estimatedHours: hours.ok ? hours.value : null,
      weight: gradable && weight.ok ? weight.value : null,
      score: hasScore ? score.value : null,
      maxScore: gradable ? (hasScore ? effMax : maxScore.ok ? maxScore.value : null) : null,
      description: form.description,
      notes: form.notes,
    };
    const existing = state?.item;
    // Getting a grade back means the work is done: mark it completed unless the status was changed by hand.
    if (hasScore && (existing?.score ?? null) === null && form.status === initial.status && patch.status !== 'completed') patch.status = 'completed';
    if (existing) {
      update((d) => {
        const it = d.items.find((i) => i.id === existing.id);
        if (!it) return;
        const wasDone = it.status === 'completed';
        Object.assign(it, patch, { updatedAt: now });
        it.completedAt = it.status === 'completed' ? (wasDone ? it.completedAt : now) : null;
      });
      toast({ tone: 'success', message: 'Changes saved' });
    } else {
      const item = newItem({ ...patch, completedAt: patch.status === 'completed' ? now : null });
      update((d) => {
        d.items.push(item);
      });
      toast({ tone: 'success', message: `${KIND_LABEL[item.kind]} added${item.dueDate ? ` · due ${formatDate.short(item.dueDate)}` : ''}` });
    }
    onClose();
  };

  return (
    <Modal
      open={!!state}
      onClose={() => void requestClose()}
      closeOnBackdrop={false}
      size="lg"
      title={state?.item ? `Edit ${KIND_LABEL[state.item.kind].toLowerCase()}` : 'New assignment or task'}
      description={
        state?.item?.source?.removed
          ? 'No longer on Blackboard — kept because you changed it. Delete it if it is not needed any more.'
          : state?.item?.source?.kind === 'blackboard'
            ? 'From Blackboard: dates and grades update when you sync; your status, notes and reminders are kept.'
            : state?.item?.source?.kind === 'ics'
              ? 'Imported from a calendar file.'
              : undefined
      }
      footer={
        <>
          <span className="footer-hint">{IS_MAC ? '⌘' : 'Ctrl'}↵ to save</span>
          <Button variant="secondary" onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check size={16} />} onClick={save} data-testid="save-item">
            {state?.item ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <label className="field span-2">
          <span className="field-label">Title</span>
          <input className={`input input-lg ${show('title') ? 'has-error' : ''}`} value={form.title} maxLength={LIMITS.titleLength + 20} placeholder="e.g. Problem Set 3" onChange={(e) => set('title', e.target.value)} data-autofocus aria-invalid={!!show('title')} />
          <FieldError error={show('title')} />
        </label>

        <div className="field span-2">
          <span className="field-label">Type</span>
          <div className="kind-picker" role="radiogroup" aria-label="Type">
            {KIND_ORDER.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} className={`kind-chip ${form.kind === k ? 'is-active' : ''}`} onClick={() => set('kind', k)}>
                <KindIcon kind={k} size={14} />
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Course</span>
          <select className="input select" value={form.courseId} onChange={(e) => set('courseId', e.target.value)} aria-label="Course">
            <option value="">{form.kind === 'personal' ? 'None (personal)' : 'No course'}</option>
            {courseGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">Due</span>
          <div className="date-time">
            <input type="date" className={`input ${show('dueDate') ? 'has-error' : ''}`} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} aria-label="Due date" min="1900-01-01" max="2200-12-31" />
            <input type="time" className={`input time-input ${show('dueTime') ? 'has-error' : ''}`} value={form.dueTime} onChange={(e) => set('dueTime', e.target.value)} aria-label="Due time" />
            {(form.dueDate || form.dueTime) && (
              <IconButton label="Clear due date" size="sm" onClick={() => setForm((f) => ({ ...f, dueDate: '', dueTime: '' }))}>
                <X size={14} />
              </IconButton>
            )}
          </div>
          <FieldError error={show('dueDate') ?? show('dueTime')} />
        </div>

        <div className="field">
          <span className="field-label">Status</span>
          <Segmented<ItemStatus>
            label="Status"
            value={form.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'not_started', label: 'Not started' },
              { value: 'in_progress', label: 'In progress' },
              { value: 'completed', label: 'Completed' },
            ]}
          />
        </div>

        <div className="field">
          <span className="field-label">Priority</span>
          <Segmented<Priority>
            label="Priority"
            value={form.priority}
            onChange={(v) => set('priority', v)}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
        </div>

        <label className="field">
          <span className="field-label">Reminder</span>
          <select className="input select" value={form.reminder} onChange={(e) => set('reminder', e.target.value as ReminderOffset)} aria-label="Reminder" disabled={!form.dueDate}>
            {(Object.keys(REMINDER_LABEL) as ReminderOffset[]).map((r) => (
              <option key={r} value={r}>
                {REMINDER_LABEL[r]}
              </option>
            ))}
          </select>
          {!form.dueDate && <span className="field-hint">Add a due date to get a reminder.</span>}
        </label>

        <label className="field">
          <span className="field-label">Estimated work</span>
          <RawNumber value={form.estimatedHours} onChange={(v) => set('estimatedHours', v)} placeholder="Optional" label="Estimated hours" suffix="hours" error={show('estimatedHours')} />
          <FieldError error={show('estimatedHours')} />
        </label>

        {form.kind !== 'personal' && (
          <fieldset className="field span-2 grading-box">
            <legend className="field-label">Grade</legend>
            {!course ? (
              <p className="field-hint">Choose a course to record a weight and grade for this {KIND_LABEL[form.kind].toLowerCase()}.</p>
            ) : (
              <>
                <div className="grading-grid">
                  <label className="field">
                    <span className="field-sublabel">Weight of course grade</span>
                    <RawNumber value={form.weight} onChange={(v) => set('weight', v)} placeholder="e.g. 20" label="Weight" suffix="%" error={show('weight')} />
                  </label>
                  <label className="field">
                    <span className="field-sublabel">Score</span>
                    <RawNumber value={form.score} onChange={(v) => set('score', v)} placeholder="Not graded" label="Score" error={show('score')} />
                  </label>
                  <label className="field">
                    <span className="field-sublabel">Out of</span>
                    <RawNumber value={form.maxScore} onChange={(v) => set('maxScore', v)} placeholder={String(scaleMax)} label="Out of" error={show('maxScore')} />
                  </label>
                  <div className="grade-preview">
                    <span className="field-sublabel">Grade</span>
                    <span className="grade-preview-value">{preview === null ? '—' : formatGrade(preview, settings.gradeScale, true)}</span>
                  </div>
                </div>
                <FieldError error={show('weight') ?? show('score') ?? show('maxScore')} />
                <p className={`field-hint ${totalWeight > 100 + 1e-9 ? 'is-warning' : ''}`}>
                  Weights in {course.name}: {formatNumber(totalWeight, 1)}% of 100%{totalWeight > 100 + 1e-9 ? ' — that’s more than 100%.' : '.'}
                </p>
              </>
            )}
          </fieldset>
        )}

        <label className="field span-2">
          <span className="field-label">Description</span>
          <textarea className="input textarea" rows={2} value={form.description} maxLength={LIMITS.notesLength} placeholder="What needs to be done?" onChange={(e) => set('description', e.target.value)} />
        </label>
        <label className="field span-2">
          <span className="field-label">Notes</span>
          <textarea className="input textarea" rows={2} value={form.notes} maxLength={LIMITS.notesLength} placeholder="Links, feedback, ideas…" onChange={(e) => set('notes', e.target.value)} />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Course editor
// ---------------------------------------------------------------------------

interface SlotForm {
  id: string;
  day: Weekday;
  start: string;
  end: string;
  room: string;
  type: SlotType;
}

interface CourseForm {
  name: string;
  code: string;
  professor: string;
  credits: string;
  semesterId: string; // '' none, '__new' new
  newSemesterName: string;
  room: string;
  color: number;
  schedule: SlotForm[];
  gradeOverride: string;
  targetGrade: string;
  totalSessions: string;
  notes: string;
  category: CourseCategory | '';
  countsInGpa: boolean;
  honors: boolean;
  outcome: 'pass' | 'fail' | '';
}

const SLOT_TYPES: { value: SlotType; label: string }[] = [
  { value: 'lecture', label: 'Lecture' },
  { value: 'seminar', label: 'Seminar' },
  { value: 'lab', label: 'Lab' },
  { value: 'tutorial', label: 'Tutorial' },
  { value: 'other', label: 'Other' },
];

function CourseEditor({ state, onClose }: { state: { course: Course | null; defaults: Partial<Course> } | null; onClose: () => void }) {
  const { data, update } = useStore();
  const toast = useToast();
  const { settings } = data;
  const scale = settings.gradeScale;

  const initial = useMemo<CourseForm>(() => {
    const c = state?.course;
    const cur = currentSemester(data);
    const semId = c ? (c.semesterId ?? '') : (state?.defaults.semesterId ?? cur?.id ?? (data.semesters.length === 0 ? '__new' : ''));
    // Next free colour within the semester.
    const used = new Set(data.courses.filter((x) => x.semesterId === (semId || null)).map((x) => x.color));
    const freeColor = Array.from({ length: COURSE_COLORS }, (_, i) => i).find((i) => !used.has(i)) ?? data.courses.length % COURSE_COLORS;
    return {
      name: c?.name ?? '',
      code: c?.code ?? '',
      professor: c?.professor ?? '',
      credits: c ? inputNumber(c.credits) : '6',
      semesterId: semId,
      newSemesterName: suggestSemester().name,
      room: c?.room ?? '',
      color: c?.color ?? freeColor,
      schedule: c?.schedule.map((s) => ({ ...s })) ?? [],
      gradeOverride: c?.gradeOverride !== null && c?.gradeOverride !== undefined ? inputNumber(round(toScale(c.gradeOverride, scale), 2)) : '',
      targetGrade: c?.targetGrade !== null && c?.targetGrade !== undefined ? inputNumber(round(toScale(c.targetGrade, scale), 2)) : '',
      totalSessions: c?.totalSessions ? String(c.totalSessions) : '',
      notes: c?.notes ?? '',
      category: c?.category ?? '',
      countsInGpa: c?.countsInGpa ?? true,
      honors: c?.honors ?? false,
      outcome: c?.outcome ?? '',
    };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState<CourseForm>(initial);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => setForm(initial), [initial]);
  const set = <K extends keyof CourseForm>(k: K, v: CourseForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setSlot = (id: string, patch: Partial<SlotForm>) => setForm((f) => ({ ...f, schedule: f.schedule.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const requestClose = useDiscardGuard(dirty, onClose);

  const scaleMax = SCALE_MAX[scale];
  const credits = parseNumber(form.credits, { label: 'Credits', max: LIMITS.credits });
  const override = parseNumber(form.gradeOverride, { label: 'Grade', max: scaleMax });
  const target = parseNumber(form.targetGrade, { label: 'Target', max: scaleMax });
  const sessions = parseNumber(form.totalSessions, { label: 'Sessions', max: LIMITS.sessions, integer: true, min: 1 });
  const errors: Record<string, string> = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Give the course a name';
  const semIdForCheck = form.semesterId === '__new' ? '__new' : form.semesterId || null;
  const dup = data.courses.find((c) => c.id !== state?.course?.id && (c.semesterId ?? null) === semIdForCheck && c.name.trim().toLowerCase() === name.toLowerCase());
  if (name && dup) errors.name = `“${dup.name}” already exists in this semester`;
  if (!credits.ok) errors.credits = credits.error;
  else if (credits.value === null) errors.credits = 'Enter the credits (0 if none)';
  if (form.semesterId === '__new' && !form.newSemesterName.trim()) errors.newSemesterName = 'Name the new semester';
  if (!override.ok) errors.gradeOverride = override.error;
  if (!target.ok) errors.targetGrade = target.error;
  if (!sessions.ok) errors.totalSessions = sessions.error;
  for (const s of form.schedule) {
    if (!isValidTime(s.start) || !isValidTime(s.end)) errors[`slot-${s.id}`] = 'Enter start and end times';
    else if (s.end <= s.start) errors[`slot-${s.id}`] = 'End time must be after the start time';
  }
  const valid = Object.keys(errors).length === 0;
  const show = (k: string) => (submitted ? errors[k] : undefined);

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    const now = new Date().toISOString();
    let semesterId: string | null = form.semesterId || null;
    let createdSemester: Semester | null = null;
    if (form.semesterId === '__new') {
      createdSemester = newSemester({ name: form.newSemesterName.trim(), ...(form.newSemesterName.trim() === suggestSemester().name ? {} : { startDate: null, endDate: null }) });
      semesterId = createdSemester.id;
    }
    const fields: Partial<Course> = {
      name,
      code: form.code.trim(),
      professor: form.professor.trim(),
      credits: credits.ok && credits.value !== null ? credits.value : 0,
      semesterId,
      room: form.room.trim(),
      color: form.color,
      schedule: form.schedule.map((s) => ({ ...s, room: s.room.trim() })),
      gradeOverride: override.ok && override.value !== null ? fromScale(override.value, scale) : null,
      targetGrade: target.ok && target.value !== null ? fromScale(target.value, scale) : null,
      totalSessions: sessions.ok ? sessions.value : null,
      notes: form.notes,
      category: form.category || null,
      countsInGpa: form.countsInGpa,
      honors: form.honors,
      outcome: form.outcome || null,
    };
    const existing = state?.course;
    update((d) => {
      if (createdSemester) {
        d.semesters.push(createdSemester);
        if (!d.settings.currentSemesterId) d.settings.currentSemesterId = createdSemester.id;
      }
      if (existing) {
        const c = d.courses.find((x) => x.id === existing.id);
        if (c) Object.assign(c, fields, { updatedAt: now });
      } else {
        d.courses.push(newCourse(fields));
      }
    });
    toast({ tone: 'success', message: existing ? 'Course updated' : `${name} added` });
    onClose();
  };

  const semesters = sortSemesters(data.semesters).reverse();

  return (
    <Modal
      open={!!state}
      onClose={() => void requestClose()}
      closeOnBackdrop={false}
      size="lg"
      title={state?.course ? 'Edit course' : 'New course'}
      footer={
        <>
          <Button variant="secondary" onClick={() => void requestClose()}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Check size={16} />} onClick={save} data-testid="save-course">
            {state?.course ? 'Save changes' : 'Create course'}
          </Button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field span-2">
          <span className="field-label">Course name</span>
          <input className={`input input-lg ${show('name') ? 'has-error' : ''}`} value={form.name} maxLength={LIMITS.nameLength} placeholder="e.g. Microeconomics" onChange={(e) => set('name', e.target.value)} data-autofocus aria-invalid={!!show('name')} />
          <FieldError error={show('name')} />
        </label>
        <label className="field">
          <span className="field-label">Code</span>
          <input className="input" value={form.code} maxLength={LIMITS.shortText} placeholder="e.g. ECON-201" onChange={(e) => set('code', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Professor</span>
          <input className="input" value={form.professor} maxLength={LIMITS.nameLength} placeholder="e.g. Dr. García" onChange={(e) => set('professor', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Credits</span>
          <RawNumber value={form.credits} onChange={(v) => set('credits', v)} label="Credits" suffix={data.settings.creditUnit} error={show('credits')} />
          <FieldError error={show('credits')} />
        </label>
        <label className="field">
          <span className="field-label">Room</span>
          <input className="input" value={form.room} maxLength={LIMITS.shortText} placeholder="e.g. Aula 2.1" onChange={(e) => set('room', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Semester</span>
          <select className="input select" value={form.semesterId} onChange={(e) => set('semesterId', e.target.value)} aria-label="Semester">
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">No semester</option>
            <option value="__new">+ New semester…</option>
          </select>
        </label>
        {form.semesterId === '__new' ? (
          <label className="field">
            <span className="field-label">New semester name</span>
            <input className={`input ${show('newSemesterName') ? 'has-error' : ''}`} value={form.newSemesterName} maxLength={LIMITS.nameLength} onChange={(e) => set('newSemesterName', e.target.value)} />
            <FieldError error={show('newSemesterName')} />
          </label>
        ) : (
          <div className="field">
            <span className="field-label">Colour</span>
            <div className="swatches" role="radiogroup" aria-label="Course colour">
              {Array.from({ length: COURSE_COLORS }, (_, i) => (
                <button key={i} type="button" role="radio" aria-checked={form.color === i} aria-label={`Colour ${i + 1}`} className={`swatch ${form.color === i ? 'is-active' : ''}`} style={{ background: courseColor(i) }} onClick={() => set('color', i)}>
                  {form.color === i && <Check size={12} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        )}
        {form.semesterId === '__new' && (
          <div className="field span-2">
            <span className="field-label">Colour</span>
            <div className="swatches" role="radiogroup" aria-label="Course colour">
              {Array.from({ length: COURSE_COLORS }, (_, i) => (
                <button key={i} type="button" role="radio" aria-checked={form.color === i} aria-label={`Colour ${i + 1}`} className={`swatch ${form.color === i ? 'is-active' : ''}`} style={{ background: courseColor(i) }} onClick={() => set('color', i)}>
                  {form.color === i && <Check size={12} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </div>
        )}

        <fieldset className="field span-2 grading-box">
          <legend className="field-label">Class schedule</legend>
          {state?.course && state.course.sessions.length > 0 && (
            <p className="field-hint">
              This course has {state.course.sessions.length} dated sessions imported from Blackboard — they are used in the calendar instead of the weekly times below.
            </p>
          )}
          {form.schedule.length === 0 && <p className="field-hint">Add weekly class times — they appear in your calendar and daily schedule.</p>}
          {form.schedule.map((s, i) => (
            <div key={s.id} className="slot-row">
              <select className="input select" value={s.day} onChange={(e) => setSlot(s.id, { day: Number(e.target.value) as Weekday })} aria-label={`Class ${i + 1} day`}>
                {WEEKDAYS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.long}
                  </option>
                ))}
              </select>
              <input type="time" className={`input time-input ${show(`slot-${s.id}`) ? 'has-error' : ''}`} value={s.start} onChange={(e) => setSlot(s.id, { start: e.target.value })} aria-label={`Class ${i + 1} start`} />
              <span className="slot-dash">–</span>
              <input type="time" className={`input time-input ${show(`slot-${s.id}`) ? 'has-error' : ''}`} value={s.end} onChange={(e) => setSlot(s.id, { end: e.target.value })} aria-label={`Class ${i + 1} end`} />
              <select className="input select" value={s.type} onChange={(e) => setSlot(s.id, { type: e.target.value as SlotType })} aria-label={`Class ${i + 1} type`}>
                {SLOT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input className="input" value={s.room} placeholder={form.room || 'Room'} maxLength={LIMITS.shortText} onChange={(e) => setSlot(s.id, { room: e.target.value })} aria-label={`Class ${i + 1} room`} />
              <IconButton label={`Remove class ${i + 1}`} size="sm" tone="danger" onClick={() => setForm((f) => ({ ...f, schedule: f.schedule.filter((x) => x.id !== s.id) }))}>
                <Trash2 size={14} />
              </IconButton>
              {show(`slot-${s.id}`) && <span className="field-error slot-error">{show(`slot-${s.id}`)}</span>}
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            icon={<CalendarPlus size={15} />}
            onClick={() =>
              setForm((f) => {
                const last = f.schedule[f.schedule.length - 1];
                const next: SlotForm = last ? { ...last, id: uid(), day: (((last.day + 2) % 7) as Weekday) } : { id: uid(), day: 1, start: '09:00', end: '10:30', room: '', type: 'lecture' };
                return { ...f, schedule: [...f.schedule, next] };
              })
            }
          >
            Add class time
          </Button>
        </fieldset>

        <label className="field">
          <span className="field-label">Final grade (optional)</span>
          <RawNumber value={form.gradeOverride} onChange={(v) => set('gradeOverride', v)} placeholder="Calculated" label="Final grade" suffix={`/ ${scaleMax}`} error={show('gradeOverride')} />
          {show('gradeOverride') ? <FieldError error={show('gradeOverride')} /> : <span className="field-hint">Leave empty to calculate it from your graded work.</span>}
        </label>
        <label className="field">
          <span className="field-label">Target grade</span>
          <RawNumber value={form.targetGrade} onChange={(v) => set('targetGrade', v)} placeholder={formatGrade(settings.defaultTargetPercent, scale)} label="Target grade" suffix={`/ ${scaleMax}`} error={show('targetGrade')} />
          <FieldError error={show('targetGrade')} />
        </label>
        <label className="field">
          <span className="field-label">Course type</span>
          <select className="input select" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as CourseCategory | '', countsInGpa: e.target.value === 'supplementary' ? false : e.target.value && f.category === 'supplementary' ? true : f.countsInGpa }))} aria-label="Course type">
            <option value="">Not set</option>
            <option value="basic">Basic</option>
            <option value="compulsory">Compulsory</option>
            <option value="elective">Elective</option>
            <option value="supplementary">Supplementary training</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Pass / fail result</span>
          <select className="input select" value={form.outcome} onChange={(e) => set('outcome', e.target.value as 'pass' | 'fail' | '')} aria-label="Pass or fail result">
            <option value="">Graded course</option>
            <option value="pass">Pass (Apto)</option>
            <option value="fail">Fail (No apto)</option>
          </select>
        </label>
        <div className="field span-2 check-row">
          <label className="check">
            <input type="checkbox" checked={form.countsInGpa} onChange={(e) => set('countsInGpa', e.target.checked)} />
            <span>Counts toward GPA</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.honors} onChange={(e) => set('honors', e.target.checked)} />
            <span>Matrícula de Honor (honours)</span>
          </label>
        </div>
        <label className="field">
          <span className="field-label">Total class sessions (optional)</span>
          <RawNumber value={form.totalSessions} onChange={(v) => set('totalSessions', v)} placeholder="e.g. 30" label="Total sessions" error={show('totalSessions')} />
          {show('totalSessions') ? <FieldError error={show('totalSessions')} /> : <span className="field-hint">Used to tell you how many classes you can still miss.</span>}
        </label>
        <label className="field span-2">
          <span className="field-label">Notes</span>
          <textarea className="input textarea" rows={3} value={form.notes} maxLength={LIMITS.notesLength} placeholder="Syllabus details, office hours, grading rules…" onChange={(e) => set('notes', e.target.value)} />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Semester manager
// ---------------------------------------------------------------------------

function SemesterRow({ semester, isCurrent, courseCount, onSave, onDelete, onMakeCurrent }: { semester: Semester; isCurrent: boolean; courseCount: number; onSave: (patch: Partial<Semester>) => void; onDelete: () => void; onMakeCurrent: () => void }) {
  const [name, setName] = useState(semester.name);
  const [start, setStart] = useState(semester.startDate ?? '');
  const [end, setEnd] = useState(semester.endDate ?? '');
  useEffect(() => {
    setName(semester.name);
    setStart(semester.startDate ?? '');
    setEnd(semester.endDate ?? '');
  }, [semester]);
  const error = !name.trim() ? 'Name required' : start && end && end < start ? 'End date is before the start date' : null;
  const commit = (next: { name?: string; start?: string; end?: string }) => {
    const n = (next.name ?? name).trim();
    const s = next.start ?? start;
    const e = next.end ?? end;
    if (!n || (s && e && e < s)) return;
    onSave({ name: n, startDate: isValidDateStr(s) ? s : null, endDate: isValidDateStr(e) ? e : null });
  };
  return (
    <div className={`semester-row ${isCurrent ? 'is-current' : ''}`} data-testid="semester-row">
      <button className={`semester-current ${isCurrent ? 'is-on' : ''}`} onClick={onMakeCurrent} title={isCurrent ? 'Current semester' : 'Make current'} aria-label={isCurrent ? `${semester.name} is the current semester` : `Make ${semester.name} the current semester`} aria-pressed={isCurrent}>
        <Star size={15} />
      </button>
      <input className={`input ${!name.trim() ? 'has-error' : ''}`} value={name} maxLength={LIMITS.nameLength} aria-label="Semester name" onChange={(e) => { setName(e.target.value); commit({ name: e.target.value }); }} />
      <input type="date" className="input" value={start} aria-label={`${semester.name} start date`} onChange={(e) => { setStart(e.target.value); commit({ start: e.target.value }); }} />
      <input type="date" className={`input ${start && end && end < start ? 'has-error' : ''}`} value={end} aria-label={`${semester.name} end date`} onChange={(e) => { setEnd(e.target.value); commit({ end: e.target.value }); }} />
      <span className="semester-count muted small">{plural(courseCount, 'course')}</span>
      <IconButton label={`Delete ${semester.name}`} size="sm" tone="danger" onClick={onDelete}>
        <Trash2 size={14} />
      </IconButton>
      {error && <span className="field-error slot-error">{error}</span>}
    </div>
  );
}

function SemesterManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, update } = useStore();
  const confirm = useConfirm();
  const cur = currentSemester(data);
  const semesters = sortSemesters(data.semesters).reverse();

  const add = () => {
    const existing = new Set(data.semesters.map((s) => s.name.toLowerCase()));
    const base = suggestSemester();
    const s = newSemester(existing.has(base.name.toLowerCase()) ? { name: `Semester ${data.semesters.length + 1}`, startDate: null, endDate: null } : {});
    update((d) => {
      d.semesters.push(s);
      if (!d.settings.currentSemesterId) d.settings.currentSemesterId = s.id;
    });
  };

  const remove = async (s: Semester) => {
    const count = data.courses.filter((c) => c.semesterId === s.id).length;
    const ok = await confirm({
      title: `Delete ${s.name}?`,
      message: count ? `Its ${plural(count, 'course')} will be kept and moved to “No semester”.` : 'This semester has no courses.',
      confirmLabel: 'Delete semester',
      tone: 'danger',
    });
    if (!ok) return;
    const moved = data.courses.filter((c) => c.semesterId === s.id).map((c) => c.id);
    const wasCurrent = data.settings.currentSemesterId === s.id;
    update(
      (d) => {
        d.semesters = d.semesters.filter((x) => x.id !== s.id);
        for (const c of d.courses) if (c.semesterId === s.id) c.semesterId = null;
        if (d.settings.currentSemesterId === s.id) d.settings.currentSemesterId = null;
      },
      {
        undo: {
          label: `${s.name} deleted`,
          recipe: (d) => {
            if (!d.semesters.some((x) => x.id === s.id)) d.semesters.push(s);
            for (const c of d.courses) if (moved.includes(c.id)) c.semesterId = s.id;
            if (wasCurrent) d.settings.currentSemesterId = s.id;
          },
        },
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Semesters"
      description="The starred semester is shown on your dashboard. Dates limit when classes appear in the calendar."
      footer={
        <>
          <Button variant="ghost" icon={<Plus size={16} />} onClick={add} className="mr-auto">
            Add semester
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {semesters.length === 0 ? (
        <p className="muted">No semesters yet. Add one to organise your courses.</p>
      ) : (
        <div className="semester-list">
          <div className="semester-head muted small">
            <span />
            <span>Name</span>
            <span>Starts</span>
            <span>Ends</span>
            <span />
            <span />
          </div>
          {semesters.map((s) => (
            <SemesterRow
              key={s.id}
              semester={s}
              isCurrent={cur?.id === s.id}
              courseCount={data.courses.filter((c) => c.semesterId === s.id).length}
              onSave={(patch) =>
                update((d) => {
                  const x = d.semesters.find((y) => y.id === s.id);
                  if (x) Object.assign(x, patch, { updatedAt: new Date().toISOString() });
                })
              }
              onDelete={() => void remove(s)}
              onMakeCurrent={() => update((d) => void (d.settings.currentSemesterId = s.id))}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

