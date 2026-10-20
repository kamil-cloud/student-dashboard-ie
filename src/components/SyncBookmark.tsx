import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useToast } from './feedback';
import { Button, Modal } from './ui';
import { openBlackboardTab } from '../platform/blackboard';
import { bookmarkletCode } from '../platform/relay';

export const BOOKMARK_NAME = 'Sync Student Dashboard';

type BrowserKind = 'safari' | 'chromium' | 'firefox' | 'iphone' | 'android' | 'other';

export function browserKind(): BrowserKind {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent);

const BAR_TIP: Record<BrowserKind, string> = {
  safari: 'Safari: show the Favorites bar first (View › Show Favorites Bar, or ⇧⌘B), then drag the button onto it.',
  chromium: `Show the bookmarks bar first (${IS_MAC ? '⇧⌘B' : 'Ctrl+Shift+B'}), then drag the button onto it.`,
  firefox: 'Firefox: show the bookmarks toolbar first (View › Toolbars › Bookmarks Toolbar), then drag the button onto it.',
  iphone: '',
  android: '',
  other: 'Drag the button to your bookmarks or favorites bar.',
};

/** The bookmark itself: drag it to the bookmarks bar (clicking it here does nothing). */
export function BookmarkLink() {
  const ref = useRef<HTMLAnchorElement>(null);
  const toast = useToast();
  // React refuses javascript: links in markup, so the address is set on the element directly.
  useEffect(() => {
    ref.current?.setAttribute('href', bookmarkletCode());
  }, []);
  return (
    <a
      ref={ref}
      className="bm-link"
      draggable
      title="Drag me to your bookmarks bar"
      onClick={(e) => {
        e.preventDefault();
        toast({ message: 'Drag this button to your bookmarks bar, then click it when you are on Blackboard.', duration: 6000 });
      }}
      data-testid="bm-link"
    >
      <Bookmark size={15} /> {BOOKMARK_NAME}
    </a>
  );
}

function CopyCode() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletCode());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked: the text box below can be selected by hand */
    }
  };
  return (
    <div className="bm-copy">
      <Button size="sm" variant="secondary" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()} data-testid="bm-copy">
        {copied ? 'Copied' : 'Copy the bookmark'}
      </Button>
    </div>
  );
}

function PhoneSteps({ kind }: { kind: 'iphone' | 'android' }) {
  return kind === 'iphone' ? (
    <ol className="bm-steps">
      <li>
        Tap <strong>Copy the bookmark</strong> below.
      </li>
      <li>
        Bookmark this page: tap the Share button, then <strong>Add Bookmark</strong>. Name it “{BOOKMARK_NAME}” and save.
      </li>
      <li>
        Open your bookmarks › <strong>Edit</strong>, tap that bookmark and replace its address with what you copied (tap the address, Select All, Paste).
      </li>
      <li>To sync: on Blackboard in Safari, open your bookmarks and tap it.</li>
    </ol>
  ) : (
    <ol className="bm-steps">
      <li>
        Tap <strong>Copy the bookmark</strong> below.
      </li>
      <li>
        Bookmark this page (⋮ › ☆), then tap <strong>Edit</strong>: name it “{BOOKMARK_NAME}” and paste what you copied as its address.
      </li>
      <li>To sync: on Blackboard, type “Sync Student” in the address bar and tap the bookmark in the suggestions.</li>
    </ol>
  );
}

/** How to add the bookmark, for this browser (and for phones). */
export function BookmarkSetup() {
  const kind = browserKind();
  const phone = kind === 'iphone' || kind === 'android';
  return (
    <div className="bm-setup" data-testid="bm-setup">
      {phone ? (
        <>
          <PhoneSteps kind={kind} />
          <CopyCode />
        </>
      ) : (
        <>
          <div className="bm-drag">
            <BookmarkLink />
            <span className="muted small">← drag it to your bookmarks bar</span>
          </div>
          <p className="muted small">{BAR_TIP[kind]}</p>
          <p className="muted small">On a phone too? Open this website on your phone: it shows the steps for it there.</p>
        </>
      )}
    </div>
  );
}

/** "Sync now" on the website: Blackboard is read through the bookmark, clicked on Blackboard. */
export function BookmarkPrompt({ host, onClose }: { host: string; onClose: () => void }) {
  const [setup, setSetup] = useState(false);
  return (
    <Modal open onClose={onClose} title="Sync with Blackboard">
      <div className="bm-prompt" data-testid="bm-prompt">
        <p className="muted small">Browsers don’t let a website read Blackboard by itself, so the sync goes through your bookmark:</p>
        <ol className="bm-steps">
          <li>
            Open Blackboard (log in if it asks).
            <div className="bm-open">
              <Button variant="primary" size="sm" icon={<ExternalLink size={14} />} onClick={() => openBlackboardTab(host)} data-testid="bm-prompt-open">
                Open Blackboard
              </Button>
            </div>
          </li>
          <li>
            Click <strong>{BOOKMARK_NAME}</strong> in your bookmarks. This page syncs by itself.
          </li>
        </ol>
        <p className="bm-waiting muted small">
          <Loader2 size={14} className="spin" /> Waiting for the bookmark…
        </p>
        <button type="button" className="link-button" onClick={() => setSetup((v) => !v)}>
          {setup ? 'Hide' : 'No bookmark yet?'}
        </button>
        {setup && <BookmarkSetup />}
      </div>
    </Modal>
  );
}
