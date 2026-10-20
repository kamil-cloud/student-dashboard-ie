import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Button, Modal } from './ui';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export type ToastTone = 'default' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  leaving: boolean;
}

const ToastContext = createContext<(opts: ToastOptions) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const TONE_ICON = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 200);
  }, []);

  const push = useCallback(
    (opts: ToastOptions) => {
      const id = ++counter.current;
      setToasts((list) => [...list.slice(-2), { ...opts, id, leaving: false }]);
      window.setTimeout(() => dismiss(id), opts.duration ?? (opts.action ? 7000 : 3500));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => {
            const Icon = TONE_ICON[t.tone ?? 'default'];
            return (
              <div key={t.id} className={`toast toast-${t.tone ?? 'default'} ${t.leaving ? 'is-leaving' : ''}`}>
                <Icon size={18} className="toast-icon" aria-hidden />
                <span className="toast-message">{t.message}</span>
                {t.action && (
                  <button
                    className="toast-action"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
                <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** User must type this exact text to enable the confirm button. */
  requireText?: string;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; open: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setTyped('');
    setState({ opts, open: true });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setState((s) => (s ? { ...s, open: false } : s));
  };

  const opts = state?.opts;
  const blocked = !!opts?.requireText && typed.trim() !== opts.requireText;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state?.open}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              {opts?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={opts?.tone === 'danger' ? 'danger' : 'primary'}
              disabled={blocked}
              onClick={() => close(true)}
              data-autofocus={opts?.requireText ? undefined : true}
            >
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {opts?.message && <div className="confirm-message">{opts.message}</div>}
        {opts?.requireText && (
          <label className="field">
            <span className="field-label">
              Type <strong>{opts.requireText}</strong> to confirm
            </span>
            <input
              className="input"
              value={typed}
              data-autofocus
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !blocked) close(true);
              }}
            />
          </label>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}
