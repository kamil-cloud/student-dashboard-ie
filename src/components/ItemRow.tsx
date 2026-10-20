import { Check, CheckCircle2, Circle, CircleDot, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Menu } from './ui';
import { CourseTag, KindIcon, PriorityBadge, STATUS_LABEL } from './common';
import { useEditors } from './editors';
import { useToast } from './feedback';
import { KIND_LABEL, newItem } from '../lib/defaults';
import { formatGrade, itemPercent } from '../lib/grades';
import { dueLabel } from '../lib/schedule';
import { useStore } from '../lib/store';
import type { Item, ItemStatus } from '../lib/types';

export function useItemActions() {
  const { updateItem, update } = useStore();
  const toast = useToast();
  const setStatus = (item: Item, status: ItemStatus) =>
    updateItem(item.id, (i) => {
      i.status = status;
      i.completedAt = status === 'completed' ? (i.completedAt ?? new Date().toISOString()) : null;
    });
  const toggleDone = (item: Item) => {
    const next = item.status === 'completed' ? 'not_started' : 'completed';
    setStatus(item, next);
    if (next === 'completed')
      toast({ tone: 'success', message: `“${item.title}” completed`, action: { label: 'Undo', onClick: () => setStatus(item, item.status) } });
  };
  const duplicate = (item: Item) => {
    const { id: _id, createdAt: _created, updatedAt: _updated, ...rest } = item;
    const copy = newItem({ ...rest, title: `${item.title} (copy)`.slice(0, 120), status: 'not_started', completedAt: null, score: null });
    update((d) => {
      d.items.push(copy);
    });
    toast({ tone: 'success', message: 'Duplicated' });
    return copy;
  };
  return { setStatus, toggleDone, duplicate };
}

export function ItemRow({ item, showCourse = true, compact = false, testId = 'item-row' }: { item: Item; showCourse?: boolean; compact?: boolean; testId?: string }) {
  const { courseMap, data } = useStore();
  const { openItem, deleteItem } = useEditors();
  const { setStatus, toggleDone, duplicate } = useItemActions();
  const course = item.courseId ? courseMap.get(item.courseId) : undefined;
  const due = dueLabel(item);
  const done = item.status === 'completed';
  const pct = itemPercent(item);

  return (
    <div className={`item-row ${done ? 'is-done' : ''} ${due.tone === 'overdue' ? 'is-overdue' : ''} ${compact ? 'is-compact' : ''}`} data-testid={testId}>
      <button className={`item-check ${done ? 'is-on' : ''}`} onClick={() => toggleDone(item)} aria-pressed={done} aria-label={done ? `Mark “${item.title}” as not completed` : `Mark “${item.title}” as completed`} title={done ? 'Completed' : 'Mark as completed'}>
        {done && <Check size={13} strokeWidth={3} />}
      </button>
      <button className="item-main" onClick={() => openItem(item)} aria-label={`Open ${item.title}`}>
        <span className="item-title">{item.title}</span>
        <span className="item-meta">
          <span className="item-kind">
            <KindIcon kind={item.kind} size={13} />
            {KIND_LABEL[item.kind]}
          </span>
          {showCourse && course && <CourseTag course={course} compact={compact} />}
          {pct !== null && <span className="item-grade">{formatGrade(pct, data.settings.gradeScale, true)}</span>}
          {!compact && item.status === 'in_progress' && <span className="item-progress">In progress</span>}
        </span>
      </button>
      {!compact && <PriorityBadge priority={item.priority} />}
      <span className={`due due-${due.tone}`}>{due.text}</span>
      {!compact && (
        <Menu
          label={`${item.title} options`}
          items={[
            { label: 'Edit', icon: <Pencil size={15} />, onSelect: () => openItem(item) },
            { label: STATUS_LABEL.not_started, icon: <Circle size={15} />, onSelect: () => setStatus(item, 'not_started'), disabled: item.status === 'not_started' },
            { label: STATUS_LABEL.in_progress, icon: <CircleDot size={15} />, onSelect: () => setStatus(item, 'in_progress'), disabled: item.status === 'in_progress' },
            { label: STATUS_LABEL.completed, icon: <CheckCircle2 size={15} />, onSelect: () => setStatus(item, 'completed'), disabled: item.status === 'completed' },
            'divider',
            { label: 'Duplicate', icon: <Copy size={15} />, onSelect: () => duplicate(item) },
            { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: () => void deleteItem(item) },
          ]}
        >
          <MoreHorizontal size={18} />
        </Menu>
      )}
    </div>
  );
}
