import { IS_EXTENSION } from '../platform/env';
import { useRef, useState, type DragEvent } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, Lock, RefreshCw, UploadCloud } from 'lucide-react';
import { Badge, Button } from './ui';
import { useToast } from './feedback';
import { readPdfText, PdfReadError } from '../integrations/transcript/pdf';
import { parseIeTranscript, transcriptGpa, TranscriptError, type TranscriptCourse, type TranscriptResult } from '../integrations/transcript/ie';
import { applyTranscript, courseSemesterKey, semesterName, type TranscriptImportSummary } from '../integrations/transcript/apply';
import { formatNumber, plural } from '../lib/format';
import { api } from '../lib/storage';
import { useStore } from '../lib/store';

type Phase = { name: 'pick' } | { name: 'reading'; file: string } | { name: 'preview'; file: string; result: TranscriptResult } | { name: 'error'; message: string };

function gradeCell(c: TranscriptCourse) {
  if (c.inProgress) return <Badge tone="accent">In progress</Badge>;
  if (c.outcome === 'fail') return <span className="text-danger">{c.grade !== null ? formatNumber(c.grade, 1, 1) : 'Not passed'}</span>;
  if (c.grade === null) return c.outcome === 'pass' ? <Badge tone="success">Pass</Badge> : <span className="muted">—</span>;
  return (
    <span className="tx-grade">
      {formatNumber(c.grade, 1, 1)}
      {c.honors && <Badge tone="gold">MH</Badge>}
    </span>
  );
}

export function TranscriptImport({ onDone, onSkip, skipLabel = 'Skip for now' }: { onDone: (summary: TranscriptImportSummary) => void; onSkip?: () => void; skipLabel?: string }) {
  const { getData, replaceData } = useStore();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    setPhase({ name: 'reading', file: file.name });
    try {
      const items = await readPdfText(await file.arrayBuffer());
      setPhase({ name: 'preview', file: file.name, result: parseIeTranscript(items) });
    } catch (err) {
      const message =
        err instanceof PdfReadError || err instanceof TranscriptError
          ? err.message
          : 'Something went wrong while reading this file. Make sure it is the PDF transcript downloaded from your university.';
      setPhase({ name: 'error', message });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void read(file);
  };

  const confirm = async (result: TranscriptResult) => {
    setBusy(true);
    try {
      const current = getData();
      if (current.courses.length || current.items.length) await api.createBackup('pre-import');
      const { data, summary } = applyTranscript(getData(), result);
      replaceData(data);
      toast({ tone: 'success', message: `Transcript imported: ${plural(summary.coursesAdded, 'course')} added${summary.coursesUpdated ? `, ${summary.coursesUpdated} updated` : ''}.` });
      onDone(summary);
    } finally {
      setBusy(false);
    }
  };

  if (phase.name === 'preview') {
    const r = phase.result;
    const gpa = transcriptGpa(r.courses);
    const matches = gpa !== null && r.officialGpa !== null && Math.abs(Math.round(gpa * 10) / 10 - r.officialGpa) < 0.051;
    const passed = r.courses.filter((c) => !c.supplementary && (c.grade !== null || c.outcome === 'pass') && c.outcome !== 'fail').reduce((t, c) => t + c.ects, 0);
    const keys = [...new Set(r.courses.map((c) => courseSemesterKey(c)))].sort();
    const exch = new Set(r.exchanges.map((e) => `${e.academicYear}-${e.period}`));
    return (
      <div className="tx-preview" data-testid="transcript-preview">
        <div className="tx-file">
          <FileText size={16} /> <span className="tx-file-name">{phase.file}</span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => setPhase({ name: 'pick' })}>
            Another file
          </Button>
        </div>
        <div className="tx-stats">
          <div className="tx-stat">
            <span className="tx-stat-value" data-testid="tx-courses">{r.courses.length}</span>
            <span className="tx-stat-label">courses</span>
          </div>
          <div className="tx-stat">
            <span className="tx-stat-value">{formatNumber(passed, 0)}</span>
            <span className="tx-stat-label">ECTS passed</span>
          </div>
          <div className="tx-stat">
            <span className="tx-stat-value" data-testid="tx-gpa">{gpa === null ? '—' : formatNumber(gpa, 2, 2)}</span>
            <span className="tx-stat-label">GPA</span>
          </div>
        </div>
        {r.officialGpa !== null && (
          <p className={`tx-check ${matches ? 'is-ok' : 'is-warn'}`}>
            {matches ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {matches ? `Matches the GPA on your transcript (${formatNumber(r.officialGpa, 1, 1)}).` : `Your transcript says ${formatNumber(r.officialGpa, 1, 1)} — check the grades below.`}
          </p>
        )}
        <div className="tx-list">
          {keys.map((key) => {
            const list = r.courses.filter((c) => courseSemesterKey(c) === key);
            const years = list.map((c) => c.yearOfStudy).filter((y): y is number => y !== null);
            return (
              <div key={key} className="tx-sem">
                <div className="tx-sem-head">{semesterName(key, r.program, years.length ? Math.max(...years) : null, exch.has(key))}</div>
                {list.map((c) => (
                  <div key={`${c.code}-${c.academicYear}`} className="tx-row">
                    <span className="tx-name">
                      {c.name}
                      {c.supplementary && <span className="muted small"> · not in GPA</span>}
                    </span>
                    <span className="tx-ects muted">{formatNumber(c.ects, 0)} ECTS</span>
                    <span className="tx-grade-cell">{gradeCell(c)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <p className="muted small tx-privacy">
          <Lock size={12} /> Read on this device. Only courses and grades are kept — never your name or ID numbers.
        </p>
        <div className="tx-actions">
          {onSkip && (
            <Button variant="ghost" onClick={onSkip} disabled={busy}>
              {skipLabel}
            </Button>
          )}
          <Button variant="primary" onClick={() => void confirm(r)} disabled={busy} data-testid="transcript-import">
            Import {plural(r.courses.length, 'course')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tx-pick">
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="transcript-drop"
      >
        {phase.name === 'reading' ? (
          <>
            <Loader2 size={26} className="spin" />
            <span className="dropzone-title">Reading {phase.file}…</span>
            <span className="muted small">This happens on your device.</span>
          </>
        ) : (
          <>
            <UploadCloud size={28} />
            <span className="dropzone-title">Drop your transcript PDF here</span>
            <span className="muted small">or click to choose the file (Expediente Académico)</span>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          data-testid="transcript-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void read(file);
          }}
        />
      </div>
      {phase.name === 'error' && (
        <p className="form-error" role="alert" data-testid="transcript-error">
          <AlertCircle size={15} /> {phase.message}
        </p>
      )}
      <p className="muted small tx-privacy">
        <Lock size={12} /> Your transcript is read in this browser and never uploaded. Only courses and grades are kept{IS_EXTENSION ? '' : ', in your private account'}.
      </p>
      {onSkip && (
        <div className="tx-actions">
          <Button variant="ghost" onClick={onSkip}>
            {skipLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
