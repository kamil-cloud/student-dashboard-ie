import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { Button, EmptyState, IconButton, PageHeader, Segmented } from '../components/ui';
import { CourseTag, courseColor, KindIcon } from '../components/common';
import { useEditors } from '../components/editors';
import { ItemRow } from '../components/ItemRow';
import { addDays, formatDate, isValidDateStr, parseDateStr, startOfMonth, startOfWeek, toDateStr, todayStr } from '../lib/dates';
import { classesOn, isOverdue, orderedWeekdays, sortByDue, timeToMinutes, weekDates, type ClassOccurrence } from '../lib/schedule';
import { navigate } from '../lib/router';
import { useStore } from '../lib/store';
import type { Item, ItemKind } from '../lib/types';

type Layer = 'class' | 'exam' | 'assignment' | 'project' | 'personal';
const LAYERS: { id: Layer; label: string }[] = [
  { id: 'class', label: 'Classes' },
  { id: 'exam', label: 'Exams' },
  { id: 'assignment', label: 'Assignments' },
  { id: 'project', label: 'Projects' },
  { id: 'personal', label: 'Personal' },
];
const LAYER_OF: Record<ItemKind, Layer> = { assignment: 'assignment', quiz: 'assignment', participation: 'assignment', exam: 'exam', project: 'project', personal: 'personal' };

const HOUR_PX = 46;

function monthLabel(d: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
}

export function Calendar({ initialDate }: { initialDate?: string }) {
  const { data, courseMap } = useStore();
  const { openItem } = useEditors();
  const { settings } = data;
  const today = todayStr();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(() => (initialDate && isValidDateStr(initialDate) ? initialDate : today));
  const [selected, setSelected] = useState(cursor);
  const [layers, setLayers] = useState<Set<Layer>>(() => new Set(LAYERS.map((l) => l.id)));

  useEffect(() => {
    if (initialDate && isValidDateStr(initialDate)) {
      setCursor(initialDate);
      setSelected(initialDate);
    }
  }, [initialDate]);

  const toggleLayer = (l: Layer) =>
    setLayers((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l);
      else n.add(l);
      return n;
    });

  const itemsByDate = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of data.items) {
      if (!i.dueDate || !layers.has(LAYER_OF[i.kind])) continue;
      m.set(i.dueDate, [...(m.get(i.dueDate) ?? []), i]);
    }
    for (const [k, v] of m) m.set(k, sortByDue(v));
    return m;
  }, [data.items, layers]);

  const classesFor = (date: string): ClassOccurrence[] => (layers.has('class') ? classesOn(date, data.courses, data.semesters) : []);

  const cursorDate = parseDateStr(cursor);
  const move = (dir: -1 | 1) => {
    const next = view === 'month' ? new Date(cursorDate.getFullYear(), cursorDate.getMonth() + dir, 1) : addDays(cursorDate, 7 * dir);
    const s = toDateStr(next);
    setCursor(s);
    if (view === 'week') setSelected(toDateStr(addDays(parseDateStr(selected), 7 * dir)));
  };
  const goToday = () => {
    setCursor(today);
    setSelected(today);
  };

  const weekdays = orderedWeekdays(settings.weekStartsOn);
  const gridStart = startOfWeek(startOfMonth(cursorDate), settings.weekStartsOn);
  const monthDays = Array.from({ length: 42 }, (_, i) => toDateStr(addDays(gridStart, i)));
  const currentMonth = cursorDate.getMonth();
  const week = weekDates(cursorDate, settings.weekStartsOn);

  const title = view === 'month' ? monthLabel(cursorDate) : `${formatDate.short(week[0])} – ${formatDate.medium(week[6])}`;
  const selItems = itemsByDate.get(selected) ?? [];
  const selClasses = classesFor(selected);
  const now = new Date();

  // Week view hour range
  const weekClasses = week.map((d) => classesFor(d));
  const timedClasses = weekClasses.flat().filter((o) => o.start && o.end);
  const allStarts = timedClasses.map((o) => timeToMinutes(o.start!));
  const allEnds = timedClasses.map((o) => timeToMinutes(o.end!));
  const timedItems = week.flatMap((d) => (itemsByDate.get(d) ?? []).filter((i) => i.dueTime)).map((i) => timeToMinutes(i.dueTime!));
  const startHour = Math.max(0, Math.min(8, ...allStarts.map((m) => Math.floor(m / 60)), ...timedItems.map((m) => Math.floor(m / 60))));
  const endHour = Math.min(24, Math.max(20, ...allEnds.map((m) => Math.ceil(m / 60)), ...timedItems.map((m) => Math.ceil(m / 60) + 1)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

  return (
    <div className="page page-wide">
      <PageHeader
        title="Calendar"
        subtitle="Classes, exams, assignments and personal tasks"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openItem(null, { dueDate: selected })} data-testid="cal-add">
            Add on {formatDate.short(selected)}
          </Button>
        }
      />
      <div className="cal-toolbar">
        <div className="cal-nav">
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
          <IconButton label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => move(1)}>
            <ChevronRight size={18} />
          </IconButton>
          <h2 className="cal-title" data-testid="cal-title">
            {title}
          </h2>
        </div>
        <div className="cal-layers" role="group" aria-label="Show">
          {LAYERS.map((l) => (
            <button key={l.id} className={`layer-chip layer-${l.id} ${layers.has(l.id) ? 'is-on' : ''}`} aria-pressed={layers.has(l.id)} onClick={() => toggleLayer(l.id)}>
              <span className="layer-dot" />
              {l.label}
            </button>
          ))}
        </div>
        <Segmented<'month' | 'week'>
          label="Calendar view"
          value={view}
          onChange={setView}
          options={[
            { value: 'month', label: 'Month' },
            { value: 'week', label: 'Week' },
          ]}
        />
      </div>

      <div className="cal-layout">
        {view === 'month' ? (
          <div className="card cal-month" data-testid="cal-month">
            <div className="cal-weekdays">
              {weekdays.map((d) => (
                <span key={d.id}>{d.short}</span>
              ))}
            </div>
            <div className="cal-grid">
              {monthDays.map((date) => {
                const items = itemsByDate.get(date) ?? [];
                const classes = classesFor(date);
                const inMonth = parseDateStr(date).getMonth() === currentMonth;
                const entries = [
                  ...items.map((i) => ({ type: 'item' as const, i })),
                  ...classes.map((o) => ({ type: 'class' as const, o })),
                ];
                const shown = entries.slice(0, 3);
                const more = entries.length - shown.length;
                return (
                  <div
                    key={date}
                    role="button"
                    tabIndex={0}
                    className={`cal-cell ${inMonth ? '' : 'is-out'} ${date === today ? 'is-today' : ''} ${date === selected ? 'is-selected' : ''}`}
                    onClick={() => setSelected(date)}
                    onDoubleClick={() => openItem(null, { dueDate: date })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelected(date);
                    }}
                    aria-label={`${formatDate.long(date)}: ${items.length} deadlines, ${classes.length} classes`}
                    data-testid="cal-cell"
                    data-date={date}
                  >
                    <span className="cal-day">{parseDateStr(date).getDate()}</span>
                    <div className="cal-entries">
                      {shown.map((e) =>
                        e.type === 'item' ? (
                          <span
                            key={e.i.id}
                            className={`cal-event kind-${e.i.kind} ${e.i.status === 'completed' ? 'is-done' : ''} ${isOverdue(e.i, now) ? 'is-overdue' : ''}`}
                            style={{ ['--c' as string]: e.i.courseId ? courseColor(courseMap.get(e.i.courseId)?.color ?? 0) : 'var(--text-3)' }}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openItem(e.i);
                            }}
                            title={e.i.title}
                          >
                            <KindIcon kind={e.i.kind} size={11} />
                            <span className="cal-event-text">{e.i.title}</span>
                          </span>
                        ) : (
                          <span key={e.o.key} className="cal-class" style={{ ['--c' as string]: courseColor(e.o.course.color) }} title={`${e.o.start ? `${e.o.start}–${e.o.end}` : 'Asynchronous'} ${e.o.course.name}${e.o.title ? ` — ${e.o.title}` : ''}`}>
                            <span className="cal-class-time">{e.o.start ?? 'Async'}</span>
                            <span className="cal-event-text">{e.o.course.code || e.o.course.name}</span>
                          </span>
                        ),
                      )}
                      {more > 0 && <span className="cal-more">+{more} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="card cal-week" data-testid="cal-week">
            <div className="week-head">
              <span />
              {week.map((d) => (
                <button key={d} className={`week-day ${d === today ? 'is-today' : ''} ${d === selected ? 'is-selected' : ''}`} onClick={() => setSelected(d)}>
                  <span className="week-day-name">{formatDate.weekday(d)}</span>
                  <span className="week-day-num">{parseDateStr(d).getDate()}</span>
                </button>
              ))}
            </div>
            <div className="week-allday">
              <span className="week-allday-label">Due</span>
              {week.map((d) => (
                <div key={d} className="week-allday-cell" onDoubleClick={() => openItem(null, { dueDate: d })}>
                  {weekClasses[week.indexOf(d)]
                    .filter((o) => o.async)
                    .map((o) => (
                      <button key={o.key} className="cal-class" style={{ ['--c' as string]: courseColor(o.course.color) }} onClick={() => navigate({ name: 'course', id: o.course.id })} title={`Asynchronous session · ${o.course.name}${o.title ? ` — ${o.title}` : ''}`}>
                        <span className="cal-class-time">Async</span>
                        <span className="cal-event-text">{o.course.code || o.course.name}</span>
                      </button>
                    ))}
                  {(itemsByDate.get(d) ?? [])
                    .filter((i) => !i.dueTime)
                    .map((i) => (
                      <button key={i.id} className={`cal-event kind-${i.kind} ${i.status === 'completed' ? 'is-done' : ''}`} style={{ ['--c' as string]: i.courseId ? courseColor(courseMap.get(i.courseId)?.color ?? 0) : 'var(--text-3)' }} onClick={() => openItem(i)} title={i.title}>
                        <KindIcon kind={i.kind} size={11} />
                        <span className="cal-event-text">{i.title}</span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
            <div className="week-body">
              <div className="week-hours">
                {hours.map((h) => (
                  <span key={h} style={{ height: HOUR_PX }}>
                    {String(h).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {week.map((d, di) => {
                const classes = weekClasses[di].filter((o) => o.start && o.end);
                // Simple lane layout for overlapping classes.
                const lanes: number[] = [];
                const placed = classes.map((o) => {
                  const s = timeToMinutes(o.start!);
                  let lane = lanes.findIndex((end) => end <= s);
                  if (lane === -1) lane = lanes.length;
                  lanes[lane] = timeToMinutes(o.end!);
                  return { o, lane };
                });
                const laneCount = Math.max(1, lanes.length);
                const timed = (itemsByDate.get(d) ?? []).filter((i) => i.dueTime);
                const nowMin = now.getHours() * 60 + now.getMinutes();
                return (
                  <div key={d} className={`week-col ${d === today ? 'is-today' : ''}`} style={{ height: hours.length * HOUR_PX }} onDoubleClick={() => openItem(null, { dueDate: d })}>
                    {hours.map((h) => (
                      <span key={h} className="week-line" style={{ top: (h - startHour) * HOUR_PX }} />
                    ))}
                    {placed.map(({ o, lane }) => {
                      const top = ((timeToMinutes(o.start!) - startHour * 60) / 60) * HOUR_PX;
                      const height = Math.max(20, ((timeToMinutes(o.end!) - timeToMinutes(o.start!)) / 60) * HOUR_PX - 2);
                      return (
                        <button
                          key={o.key}
                          className="week-class"
                          style={{ top, height, left: `calc(${(lane / laneCount) * 100}% + 2px)`, width: `calc(${100 / laneCount}% - 4px)`, ['--c' as string]: courseColor(o.course.color) }}
                          onClick={() => navigate({ name: 'course', id: o.course.id })}
                          title={`${o.course.name} · ${o.start}–${o.end}${o.room ? ` · ${o.room}` : ''}${o.title ? ` — ${o.title}` : ''}`}
                          data-testid="week-class"
                        >
                          <span className="week-class-name">{o.course.name}</span>
                          <span className="week-class-meta">
                            {o.start}–{o.end}
                            {o.room && ` · ${o.room}`}
                          </span>
                        </button>
                      );
                    })}
                    {timed.map((i) => {
                      const top = ((timeToMinutes(i.dueTime!) - startHour * 60) / 60) * HOUR_PX;
                      return (
                        <button key={i.id} className={`week-item kind-${i.kind} ${i.status === 'completed' ? 'is-done' : ''}`} style={{ top, ['--c' as string]: i.courseId ? courseColor(courseMap.get(i.courseId)?.color ?? 0) : 'var(--text-3)' }} onClick={() => openItem(i)} title={`${i.dueTime} ${i.title}`}>
                          <KindIcon kind={i.kind} size={11} />
                          <span className="cal-event-text">
                            {i.dueTime} {i.title}
                          </span>
                        </button>
                      );
                    })}
                    {d === today && nowMin >= startHour * 60 && nowMin <= endHour * 60 && <span className="now-line" style={{ top: ((nowMin - startHour * 60) / 60) * HOUR_PX }} />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <aside className="card day-panel" data-testid="day-panel">
          <header className="day-panel-head">
            <div>
              <span className="kicker">{selected === today ? 'Today' : formatDate.weekday(selected)}</span>
              <h2>{formatDate.long(selected)}</h2>
            </div>
            <IconButton label={`Add on ${formatDate.short(selected)}`} onClick={() => openItem(null, { dueDate: selected })}>
              <Plus size={18} />
            </IconButton>
          </header>
          {selClasses.length === 0 && selItems.length === 0 ? (
            <EmptyState compact icon={<CalendarDays size={20} />} title="Nothing on this day" description="Double-click a day to add a deadline." />
          ) : (
            <>
              {selClasses.length > 0 && (
                <div className="list-section">
                  <div className="list-label">Classes</div>
                  {selClasses.map((o) => (
                    <button key={o.key} className="day-class" onClick={() => navigate({ name: 'course', id: o.course.id })}>
                      <span className="day-class-time">
                        {o.start ? `${o.start}–${o.end}` : 'Asynchronous'}
                      </span>
                      <CourseTag course={o.course} />
                      {(o.title || (o.room && !o.async)) && (
                        <span className="muted small">
                          {o.title}
                          {o.title && o.room && !o.async ? ' · ' : ''}
                          {o.room && !o.async && (
                            <>
                              <MapPin size={11} /> {o.room}
                            </>
                          )}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {selItems.length > 0 && (
                <div className="list-section">
                  <div className="list-label">Due</div>
                  {selItems.map((i) => (
                    <ItemRow key={i.id} item={i} compact />
                  ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
