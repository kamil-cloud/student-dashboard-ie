import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Search, SearchX } from 'lucide-react';
import { Button, EmptyState, PageHeader, Segmented } from '../components/ui';
import { useEditors } from '../components/editors';
import { ItemRow } from '../components/ItemRow';
import { addDays, parseDateStr, toDateStr } from '../lib/dates';
import { KIND_LABEL, KIND_ORDER } from '../lib/defaults';
import { currentSemester, dueMoment, isOverdue, isTask, sortSemesters } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Item, ItemKind, ItemStatus, Priority } from '../lib/types';

type StatusFilter = 'open' | ItemStatus | 'all';
type Sort = 'due' | 'priority' | 'course' | 'created' | 'title';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function bucketOf(item: Item, now: Date): { key: string; label: string; order: number } {
  if (item.status === 'completed') return { key: 'done', label: 'Completed', order: 7 };
  if (!item.dueDate) return { key: 'none', label: 'No due date', order: 6 };
  if (isOverdue(item, now)) return { key: 'overdue', label: 'Overdue', order: 0 };
  const today = toDateStr(now);
  if (item.dueDate === today) return { key: 'today', label: 'Today', order: 1 };
  if (item.dueDate === toDateStr(addDays(parseDateStr(today), 1))) return { key: 'tomorrow', label: 'Tomorrow', order: 2 };
  if (item.dueDate <= toDateStr(addDays(parseDateStr(today), 7))) return { key: 'week', label: 'Next 7 days', order: 3 };
  if (item.dueDate <= toDateStr(addDays(parseDateStr(today), 30))) return { key: 'month', label: 'Next 30 days', order: 4 };
  return { key: 'later', label: 'Later', order: 5 };
}

export function Assignments() {
  const { data, courseMap } = useStore();
  const { openItem } = useEditors();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [courseId, setCourseId] = useState<string>('all');
  const [kind, setKind] = useState<ItemKind | 'all'>('all');
  const [priority, setPriority] = useState<Priority | 'all'>('all');
  const [sort, setSort] = useState<Sort>('due');
  const now = new Date();

  // Participation marks are grade components: only listed when that type is selected.
  const pool = useMemo(() => data.items.filter((i) => isTask(i) || kind === 'participation'), [data.items, kind]);
  const counts = useMemo(
    () => ({
      open: pool.filter((i) => i.status !== 'completed').length,
      not_started: pool.filter((i) => i.status === 'not_started').length,
      in_progress: pool.filter((i) => i.status === 'in_progress').length,
      completed: pool.filter((i) => i.status === 'completed').length,
      all: pool.length,
    }),
    [pool],
  );

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = pool.filter((i) => {
      if (status === 'open' && i.status === 'completed') return false;
      if (status !== 'open' && status !== 'all' && i.status !== status) return false;
      if (courseId === 'none' ? i.courseId !== null : courseId !== 'all' && i.courseId !== courseId) return false;
      if (kind !== 'all' && i.kind !== kind) return false;
      if (priority !== 'all' && i.priority !== priority) return false;
      if (terms.length) {
        const hay = `${i.title} ${i.description} ${i.notes} ${courseMap.get(i.courseId ?? '')?.name ?? ''} ${KIND_LABEL[i.kind]}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const due = (i: Item) => dueMoment(i)?.getTime() ?? Infinity;
    const cmp: Record<Sort, (a: Item, b: Item) => number> = {
      due: (a, b) => due(a) - due(b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || due(a) - due(b),
      course: (a, b) => (courseMap.get(a.courseId ?? '')?.name ?? '~').localeCompare(courseMap.get(b.courseId ?? '')?.name ?? '~') || due(a) - due(b),
      created: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return list.sort(cmp[sort]);
  }, [pool, query, status, courseId, kind, priority, sort, courseMap]);

  const groups = useMemo(() => {
    if (sort !== 'due') return [{ key: 'all', label: '', items: filtered }];
    const map = new Map<string, { key: string; label: string; order: number; items: Item[] }>();
    for (const i of filtered) {
      const b = bucketOf(i, now);
      const g = map.get(b.key) ?? { ...b, items: [] };
      g.items.push(i);
      map.set(b.key, g);
    }
    return [...map.values()].sort((a, b) => a.order - b.order);
  }, [filtered, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const semesters = sortSemesters(data.semesters).reverse();
  const cur = currentSemester(data);
  const filtersActive = query || status !== 'open' || courseId !== 'all' || kind !== 'all' || priority !== 'all';
  const clear = () => {
    setQuery('');
    setStatus('open');
    setCourseId('all');
    setKind('all');
    setPriority('all');
  };

  return (
    <div className="page">
      <PageHeader
        title="Assignments & tasks"
        subtitle={`${counts.open} open · ${counts.completed} completed`}
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openItem(null, courseId !== 'all' && courseId !== 'none' ? { courseId } : kind !== 'all' ? { kind } : {})} data-testid="new-item">
            New
          </Button>
        }
      />

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ClipboardList size={26} />}
            title="No assignments or tasks yet"
            description="Add assignments, exams, projects and personal tasks with deadlines, priorities and reminders."
            action={
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => openItem()}>
                Add your first task
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div className="search">
              <Search size={16} className="search-icon" aria-hidden />
              <input className="input search-input" placeholder="Search tasks…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tasks" />
            </div>
            <Segmented<StatusFilter>
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'open', label: `Open ${counts.open}` },
                { value: 'not_started', label: `Not started ${counts.not_started}` },
                { value: 'in_progress', label: `In progress ${counts.in_progress}` },
                { value: 'completed', label: `Completed ${counts.completed}` },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <div className="filter-row">
            <select className="input select filter-select" value={courseId} onChange={(e) => setCourseId(e.target.value)} aria-label="Filter by course">
              <option value="all">All courses</option>
              <option value="none">No course</option>
              {semesters.map((s) => {
                const cs = data.courses.filter((c) => c.semesterId === s.id);
                return cs.length ? (
                  <optgroup key={s.id} label={s.id === cur?.id ? `${s.name} (current)` : s.name}>
                    {cs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
              {data.courses
                .filter((c) => !c.semesterId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select className="input select filter-select" value={kind} onChange={(e) => setKind(e.target.value as ItemKind | 'all')} aria-label="Filter by type">
              <option value="all">All types</option>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <select className="input select filter-select" value={priority} onChange={(e) => setPriority(e.target.value as Priority | 'all')} aria-label="Filter by priority">
              <option value="all">Any priority</option>
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="low">Low priority</option>
            </select>
            <span className="filter-spacer" />
            <label className="sort-label">
              <span>Sort</span>
              <select className="input select filter-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
                <option value="course">Course</option>
                <option value="created">Recently added</option>
                <option value="title">Title</option>
              </select>
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="card">
              <EmptyState
                compact
                icon={<SearchX size={22} />}
                title={status === 'open' && !filtersActive ? 'All caught up!' : 'Nothing matches these filters'}
                description={status === 'open' && !filtersActive ? 'Every task is completed.' : 'Try a different search or filter.'}
                action={
                  filtersActive ? (
                    <Button variant="secondary" onClick={clear}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="task-group">
                {g.label && (
                  <header className={`group-header ${g.key === 'overdue' ? 'is-overdue' : ''}`}>
                    <h2>{g.label}</h2>
                    <span>{g.items.length}</span>
                  </header>
                )}
                <div className="card list-card">
                  {g.items.map((i) => (
                    <ItemRow key={i.id} item={i} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
