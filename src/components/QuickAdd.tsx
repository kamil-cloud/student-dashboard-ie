/**
 * The main feature of /app: type a deadline, press Add, and it is saved to your account and
 * listed below with every other deadline (Blackboard ones included).
 */
import { useState, type FormEvent } from 'react';
import { ChevronDown, ClipboardList, Plus } from 'lucide-react';
import { Button, Card, EmptyState } from './ui';
import { ItemRow } from './ItemRow';
import { newItem } from '../lib/defaults';
import { sortByDue } from '../lib/schedule';
import { useStore } from '../lib/store';

const MAX_TITLE = 200;

export function QuickAdd() {
  const { update, saveNow } = useStore();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim().slice(0, MAX_TITLE);
    if (!text) return;
    const item = newItem({ title: text, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null });
    update((d) => {
      d.items.push(item);
    });
    setTitle('');
    void saveNow();
  };

  return (
    <form className="card quick-add" onSubmit={submit} aria-label="Add a deadline">
      <label className="quick-add-label" htmlFor="core-input">
        Add a deadline
      </label>
      <div className="quick-add-row">
        <input
          id="core-input"
          className="input input-lg quick-add-title"
          type="text"
          value={title}
          maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Marketing essay, Finance midterm…"
          autoComplete="off"
          data-testid="core-input"
        />
        <input className="input input-lg quick-add-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Due date (optional)" title="Due date (optional)" data-testid="core-date" />
        <Button variant="primary" type="submit" icon={<Plus size={16} />} className="quick-add-submit" disabled={!title.trim()} data-testid="core-submit">
          Add
        </Button>
      </div>
    </form>
  );
}

/** Every saved deadline: open ones first by due date, completed ones folded away. */
export function DeadlineList() {
  const { data } = useStore();
  const [showDone, setShowDone] = useState(false);
  const open = sortByDue(data.items.filter((i) => i.status !== 'completed'));
  const done = sortByDue(data.items.filter((i) => i.status === 'completed')).reverse();

  return (
    <Card title="Your deadlines" subtitle={open.length ? `${open.length} to do` : undefined} className="deadline-list">
      {data.items.length === 0 ? (
        <EmptyState compact icon={<ClipboardList size={20} />} title="Nothing here yet" description="Add your first deadline above, or import them from Blackboard." />
      ) : (
        <>
          <div className="list-flush" data-testid="core-list">
            {open.map((i) => (
              <ItemRow key={i.id} item={i} testId="core-item" />
            ))}
          </div>
          {done.length > 0 && (
            <>
              <button className="deadline-done-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                <ChevronDown size={15} className={showDone ? 'is-open' : ''} /> Completed ({done.length})
              </button>
              {showDone && (
                <div className="list-flush">
                  {done.map((i) => (
                    <ItemRow key={i.id} item={i} testId="core-item" />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
