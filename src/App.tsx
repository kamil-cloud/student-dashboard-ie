import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ClipboardList,
  Copy,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  Moon,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  Award,
} from 'lucide-react';
import { ConfirmProvider, ToastProvider } from './components/feedback';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EditorsProvider, useEditors } from './components/editors';
import { NotificationBell, ReminderEngine, useNow } from './components/Notifications';
import { Button, Menu } from './components/ui';
import { KindIcon } from './components/common';
import { BackupProvider, useBackup } from './lib/backup';
import { todayStr } from './lib/dates';
import { navigate, useRoute, type Route } from './lib/router';
import { currentSemester } from './lib/schedule';
import { api } from './lib/storage';
import { DataProvider, handoffState, useStore, type FallbackActions, type LoadState } from './lib/store';
import { timeAgo } from './lib/format';
import { SyncProvider, useSync } from './lib/sync';
import type { ThemePref } from './lib/types';
import { Analytics } from './pages/Analytics';
import { Assignments } from './pages/Assignments';
import { Calendar } from './pages/Calendar';
import { CourseDetail } from './pages/CourseDetail';
import { Courses } from './pages/Courses';
import { Dashboard } from './pages/Dashboard';
import { Grades } from './pages/Grades';
import { Settings } from './pages/Settings';
import { Welcome, wizardStart } from './pages/Welcome';
import { LoginPage, SignupPage } from './pages/Auth';
import { Landing } from './pages/Landing';
import { goTo, usePage } from './lib/paths';
import { IS_EXTENSION } from './platform/env';
import { OPENED_BY_BOOKMARK } from './platform/relay';
import { SUPABASE_CONFIGURED, useSession } from './platform/supabase';
import { LogoutButton, logOut } from './components/Logout';

type NavName = 'dashboard' | 'calendar' | 'assignments' | 'courses' | 'grades' | 'analytics' | 'settings';

const NAV: { name: NavName; label: string; icon: typeof LayoutDashboard }[] = [
  { name: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { name: 'calendar', label: 'Calendar', icon: CalendarDays },
  { name: 'assignments', label: 'Assignments', icon: ClipboardList },
  { name: 'courses', label: 'Courses', icon: BookOpen },
  { name: 'grades', label: 'Grades', icon: Award },
  { name: 'analytics', label: 'Analytics', icon: BarChart3 },
  { name: 'settings', label: 'Settings', icon: SettingsIcon },
];

function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function useThemeSync(pref: ThemePref) {
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(pref);
      document.documentElement.dataset.theme = resolved;
      try {
        localStorage.setItem('sd-theme', resolved);
      } catch {
        /* ignore */
      }
    };
    apply();
    void api.setTheme(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

function SaveIndicator() {
  const { saveStatus, retrySave } = useStore();
  if (saveStatus === 'error') {
    return (
      <button className="save-indicator is-error" onClick={retrySave} title="Click to retry saving">
        <AlertCircle size={14} /> <span className="nav-label">Not saved — retry</span>
      </button>
    );
  }
  return (
    <span className={`save-indicator ${saveStatus === 'saving' ? 'is-saving' : ''}`} aria-live="polite" data-testid="save-status">
      {saveStatus === 'saving' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
      <span className="nav-label">{saveStatus === 'saving' ? 'Saving…' : 'All changes saved'}</span>
    </span>
  );
}

function SyncChip() {
  const { data } = useStore();
  const sync = useSync();
  const now = useNow(60_000);
  const bb = data.blackboard;
  if (!bb.host && !bb.calendarUrl) return null;
  const loggedOut = sync.lastError?.code === 'auth' || (sync.background?.state === 'logged-out' && Date.parse(sync.background.at) > Date.parse(bb.lastSync ?? ''));
  const last = [bb.lastSync, bb.calendarSync].filter((x): x is string => !!x).sort().pop() ?? null;
  const label = sync.running ? (sync.progress?.label ?? 'Syncing…') : loggedOut ? 'Log in to Blackboard to sync' : `Blackboard · ${timeAgo(last, now)}`;
  return (
    <button className={`sync-chip ${loggedOut ? 'is-warn' : ''}`} onClick={() => void sync.syncNow()} disabled={sync.running} title="Sync with Blackboard now" data-testid="sync-chip">
      <RefreshCw size={14} className={sync.running ? 'spin' : ''} />
      <span className="nav-label">{label}</span>
    </button>
  );
}

function Shell() {
  const { data, update } = useStore();
  const backup = useBackup();
  const { openItem, openCourse } = useEditors();
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const [resetKey, setResetKey] = useState(0);
  useThemeSync(data.settings.theme);

  const pageKey = route.name === 'course' ? `course:${route.id}` : route.name;
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pageKey]);

  const refs = useRef({ backup, openItem, openCourse });
  refs.current = { backup, openItem, openCourse };
  useEffect(
    () =>
      api.onMenu((action) => {
        const r = refs.current;
        if (action === 'new-item') r.openItem(null, { dueDate: todayStr() });
        else if (action === 'new-course') r.openCourse();
        else if (action === 'export') void r.backup.exportJson();
        else if (action === 'import') void r.backup.startImport();
        else if (action.startsWith('go:')) {
          const name = action.slice(3) as NavName;
          if (NAV.some((n) => n.name === name)) navigate({ name } as Route);
        }
      }),
    [],
  );

  const resolved = resolveTheme(data.settings.theme);
  const activeNav: NavName = route.name === 'course' ? 'courses' : route.name === 'setup' ? 'dashboard' : route.name;
  const semester = currentSemester(data);

  let page;
  switch (route.name) {
    case 'dashboard':
      page = <Dashboard />;
      break;
    case 'calendar':
      page = <Calendar initialDate={route.date} />;
      break;
    case 'assignments':
      page = <Assignments />;
      break;
    case 'courses':
      page = <Courses />;
      break;
    case 'course':
      page = <CourseDetail key={route.id} id={route.id} />;
      break;
    case 'grades':
      page = <Grades />;
      break;
    case 'analytics':
      page = <Analytics />;
      break;
    case 'settings':
      page = <Settings />;
      break;
    case 'setup':
      page = <Dashboard />;
      break;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-drag" />
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={18} strokeWidth={2.2} />
          </div>
          <span className="brand-text nav-label">
            <span className="brand-name">Student Dashboard</span>
            {semester && <span className="brand-sub">{semester.name}</span>}
          </span>
        </div>
        <div className="sidebar-cta-row">
          <Button variant="primary" className="sidebar-cta" icon={<Plus size={16} />} onClick={() => openItem(null, { dueDate: todayStr() })} title="New assignment or task (⌘N)" data-testid="sidebar-new">
            <span className="nav-label">New task</span>
          </Button>
          <span className="nav-label">
            <Menu
              label="More new options"
              align="start"
              items={[
                { label: 'Assignment', icon: <KindIcon kind="assignment" size={15} />, onSelect: () => openItem(null, { kind: 'assignment', dueDate: todayStr() }) },
                { label: 'Exam', icon: <KindIcon kind="exam" size={15} />, onSelect: () => openItem(null, { kind: 'exam' }) },
                { label: 'Project', icon: <KindIcon kind="project" size={15} />, onSelect: () => openItem(null, { kind: 'project' }) },
                { label: 'Personal task', icon: <KindIcon kind="personal" size={15} />, onSelect: () => openItem(null, { kind: 'personal', dueDate: todayStr() }) },
                'divider',
                { label: 'Course', icon: <NotebookPen size={15} />, onSelect: () => openCourse() },
              ]}
            >
              <Plus size={16} />
            </Menu>
          </span>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.name;
            return (
              <button key={item.name} className={`nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => navigate({ name: item.name } as Route)} title={item.label} data-testid={`nav-${item.name}`}>
                <Icon size={18} />
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <SyncChip />
        <div className="sidebar-footer">
          <SaveIndicator />
          <button
            className="theme-toggle"
            onClick={() => update((d) => void (d.settings.theme = resolved === 'dark' ? 'light' : 'dark'))}
            aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            data-testid="theme-toggle"
          >
            {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </aside>
      <main className="main" ref={mainRef}>
        <div className="main-drag">
          <div className="main-tools">
            <NotificationBell />
            {!IS_EXTENSION && <DashboardLogout />}
          </div>
        </div>
        <ErrorBoundary
          key={`${pageKey}:${resetKey}`}
          onReset={() => {
            setResetKey((k) => k + 1);
            navigate({ name: 'dashboard' });
          }}
        >
          <div className="page-transition" key={pageKey}>
            {page}
          </div>
        </ErrorBoundary>
      </main>
      <ReminderEngine />
    </div>
  );
}

/** The dashboard's "Log out", saving pending changes first. */
function DashboardLogout() {
  const { saveNow } = useStore();
  return <LogoutButton saveNow={saveNow} />;
}

/**
 * The setup wizard: on the website only when asked for (Dashboard → "Import from Blackboard"),
 * or when the bookmark brings the student back mid-setup; in the extension, on first launch.
 */
function Gate() {
  const { data } = useStore();
  const route = useRoute();
  const [start] = useState(() => wizardStart(data));
  useEffect(() => {
    handoffState.resume = null;
  }, []);
  const onboarded = !!data.profile.onboardedAt;
  useEffect(() => {
    if (route.name === 'setup' && onboarded) navigate({ name: 'dashboard' }, { replace: true });
  }, [route.name, onboarded]);
  if (!onboarded && (start === 'blackboard' || route.name === 'setup' || (IS_EXTENSION && start === 'welcome'))) {
    return (
      <>
        {!IS_EXTENSION && (
          <div className="page-logout">
            <DashboardLogout />
          </div>
        )}
        <Welcome startAt={start === 'blackboard' ? 'blackboard' : 'welcome'} />
      </>
    );
  }
  return <Shell />;
}

function LoadScreen({ state, actions }: { state: LoadState; actions: FallbackActions }) {
  if (state.status === 'locked') {
    return (
      <div className="load-screen">
        <div className="card load-card" data-testid="locked-screen">
          <div className="empty-icon">
            <Copy size={24} />
          </div>
          <h2>{state.reason === 'lost' ? 'Opened in another tab' : 'Already open in another tab'}</h2>
          <p>
            {state.reason === 'lost'
              ? 'You continued in another tab, so this one stepped aside to keep your data safe.'
              : 'Student Dashboard is open in another tab. Only one tab can make changes at a time, so nothing gets overwritten.'}
          </p>
          <div className="load-actions">
            <Button variant="primary" onClick={actions.takeOver} data-testid="use-here">
              Use it here
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (state.status !== 'failed') {
    return (
      <div className="load-screen">
        <div className="brand-mark brand-mark-lg">
          <GraduationCap size={28} strokeWidth={2.2} />
        </div>
        <Loader2 size={18} className="spin muted" />
      </div>
    );
  }
  return (
    <div className="load-screen">
      <div className="card load-card">
        <div className="empty-icon">
          <AlertCircle size={26} />
        </div>
        <h2>We couldn’t open your data</h2>
        <p>{state.message}</p>
        {state.corruptPath && (
          <p className="muted small">
            The damaged file was kept at <code>{state.corruptPath}</code>.
          </p>
        )}
        <div className="load-actions">
          <Button
            variant="secondary"
            onClick={async () => {
              const res = await api.importBackup();
              if (res.ok && res.content) actions.importText(res.content);
            }}
          >
            Import a backup
          </Button>
          <Button variant="primary" onClick={actions.startFresh}>
            Start fresh
          </Button>
        </div>
      </div>
    </div>
  );
}

function DashboardApp() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <DataProvider
          fallback={(state, actions) => (
            <>
              {!IS_EXTENSION && (
                <div className="page-logout">
                  <LogoutButton />
                </div>
              )}
              <LoadScreen state={state} actions={actions} />
            </>
          )}
        >
          <BackupProvider>
            <SyncProvider>
              <EditorsProvider>
                <Gate />
              </EditorsProvider>
            </SyncProvider>
          </BackupProvider>
        </DataProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Loading() {
  return (
    <div className="load-screen">
      <div className="brand-mark brand-mark-lg">
        <GraduationCap size={28} strokeWidth={2.2} />
      </div>
      <Loader2 size={18} className="spin muted" />
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="load-screen">
      <div className="card load-card">
        <div className="empty-icon">
          <AlertCircle size={26} />
        </div>
        <h2>Accounts are not set up yet</h2>
        <p>This copy of Student Dashboard has no database connected (NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are missing).</p>
      </div>
    </div>
  );
}

/** The website: public landing page, sign-up and login, and the dashboard for signed-in students. */
function Website() {
  const page = usePage();
  const session = useSession();
  const signedIn = !!session;
  const redirect: Parameters<typeof goTo>[0] | null =
    session === undefined
      ? null
      : page === 'app' && !signedIn && SUPABASE_CONFIGURED
        ? 'login'
        : (page === 'signup' || page === 'login') && signedIn
          ? 'app'
          : page === 'landing' && OPENED_BY_BOOKMARK
            ? 'app'
            : null;
  useEffect(() => {
    if (redirect) goTo(redirect, { replace: true });
  }, [redirect]);

  useEffect(() => {
    document.title = page === 'signup' ? 'Sign up · Student Dashboard' : page === 'login' ? 'Log in · Student Dashboard' : 'Student Dashboard';
  }, [page]);

  if (redirect) return <Loading />;
  if (page === 'landing') return <Landing signedIn={signedIn} onLogout={() => void logOut()} />;
  if (!SUPABASE_CONFIGURED) return <NotConfigured />;
  if (session === undefined) return <Loading />;
  if (page === 'signup') return <SignupPage />;
  if (page === 'login') return <LoginPage />;
  return session ? <DashboardApp key={session.user.id} /> : <Loading />;
}

export default function App() {
  return IS_EXTENSION ? <DashboardApp /> : <Website />;
}
