import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Parsed } from '../lib/parse';

interface NumberFieldProps {
  value: number | null;
  onCommit: (value: number | null) => void;
  parse: (raw: string) => Parsed;
  format: (value: number | null) => string;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  disabled?: boolean;
  id?: string;
  onEnter?: (el: HTMLInputElement) => void;
  /** Force the error state from outside (e.g. "enter reps before marking done"). */
  externalError?: string | null;
}

/**
 * Text-based number input. Valid values are committed as you type (so nothing is lost if the
 * app closes); invalid text shows an inline error and is reverted on blur — never stored.
 */
export function NumberField({
  value,
  onCommit,
  parse,
  format,
  ariaLabel,
  placeholder,
  className = '',
  inputMode = 'decimal',
  disabled,
  id,
  onEnter,
  externalError,
}: NumberFieldProps) {
  const [text, setText] = useState(() => format(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setText(format(value));
      setError(null);
    }
  }, [value, format]);

  const shownError = error ?? externalError ?? null;

  const handleChange = (raw: string) => {
    setText(raw);
    const r = parse(raw);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (r.value !== value) onCommit(r.value);
  };

  const handleBlur = () => {
    focused.current = false;
    setError(null);
    setText(format(value));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const el = e.currentTarget;
      if (onEnter) onEnter(el);
      else el.blur();
    } else if (e.key === 'Escape' && error) {
      e.stopPropagation();
      setError(null);
      setText(format(value));
    }
  };

  return (
    <div className={`numfield ${shownError ? 'has-error' : ''} ${className}`}>
      <input
        id={id}
        className="numfield-input"
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={!!shownError}
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKey}
      />
      {shownError && (
        <div className="numfield-error" role="alert">
          {shownError}
        </div>
      )}
    </div>
  );
}
