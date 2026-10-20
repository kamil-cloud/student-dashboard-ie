import { useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

type Row = Record<string, unknown>;
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, Table2 } from 'lucide-react';
import { formatNumber } from '../lib/format';

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  unit,
  sub,
  delta,
  icon,
  progress,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  delta?: { pct: number | null; label: string } | null;
  icon?: ReactNode;
  progress?: number;
}) {
  let deltaEl: ReactNode = null;
  if (delta) {
    const pct = delta.pct;
    const dir = pct === null ? 'up' : pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
    const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
    const text = pct === null ? 'New' : `${pct > 0 ? '+' : ''}${formatNumber(pct, 0)}%`;
    deltaEl = (
      <span className={`delta delta-${dir}`}>
        <Icon size={14} aria-hidden />
        <span>{text}</span>
        <span className="delta-label">{delta.label}</span>
      </span>
    );
  }
  return (
    <div className="stat-tile">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {progress !== undefined && (
        <div className="meter" aria-hidden>
          <div className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </div>
      )}
      {(sub || deltaEl) && (
        <div className="stat-sub">
          {deltaEl}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (tiny trend, last point emphasised)
// ---------------------------------------------------------------------------

export function Sparkline({ values, width = 96, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <span className="sparkline-empty" aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--series-1)" strokeOpacity={0.45} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Chart card with chart/table toggle (every chart has a table twin)
// ---------------------------------------------------------------------------

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  empty,
  className = '',
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: { label: string; color: string; type: 'line' | 'bar' }[];
  table?: TableView;
  children: ReactNode;
  empty?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`card chart-card ${className}`}>
      <header className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
        </div>
        {table && !empty && (
          <div className="view-toggle" role="radiogroup" aria-label={`${title} view`}>
            <button role="radio" aria-checked={view === 'chart'} className={view === 'chart' ? 'is-active' : ''} onClick={() => setView('chart')} title="Chart view">
              <BarChart3 size={14} />
            </button>
            <button role="radio" aria-checked={view === 'table'} className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')} title="Table view">
              <Table2 size={14} />
            </button>
          </div>
        )}
      </header>
      {empty ? (
        <div className="chart-empty">{empty}</div>
      ) : (
        <>
          {legend && legend.length > 1 && view === 'chart' && (
            <div className="legend">
              {legend.map((l) => (
                <span key={l.label} className="legend-item">
                  <span className={`legend-key legend-${l.type}`} style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          )}
          {view === 'chart' || !table ? (
            <div className="chart-body">{children}</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((v, j) => (
                        <td key={j}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

type Fmt = (v: number) => string;

function makeTooltip(format: Fmt, labelOf?: (payload: Record<string, unknown>) => string) {
  return function ChartTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload as Record<string, unknown> | undefined;
    const title = labelOf && row ? labelOf(row) : String(label ?? '');
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-title">{title}</div>
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="chart-tooltip-row">
            <span className="chart-tooltip-key" style={{ background: String(p.color ?? p.stroke ?? p.fill) }} />
            <span className="chart-tooltip-value">{typeof p.value === 'number' ? format(p.value) : String(p.value)}</span>
            <span className="chart-tooltip-name">{p.name}</span>
          </div>
        ))}
      </div>
    );
  };
}

const AXIS_TICK = { fill: 'var(--text-3)', fontSize: 11 };

function niceTick(v: number): string {
  if (Math.abs(v) >= 10_000) return `${formatNumber(v / 1000, 0)}k`;
  if (Math.abs(v) >= 1000) return `${formatNumber(v / 1000, 1)}k`;
  return formatNumber(v, 1);
}

// ---------------------------------------------------------------------------
// Bar chart (single series)
// ---------------------------------------------------------------------------

export function SimpleBarChart({
  data,
  xKey,
  yKey,
  name,
  format,
  tickFormat = niceTick,
  labelOf,
  height = 220,
  color = 'var(--series-1)',
  allowDecimals = true,
}: {
  data: Row[];
  xKey: string;
  yKey: string;
  name: string;
  format: Fmt;
  tickFormat?: Fmt;
  labelOf?: (row: Record<string, unknown>) => string;
  height?: number;
  color?: string;
  allowDecimals?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={AXIS_TICK} minTickGap={12} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={44} tickFormatter={tickFormat} allowDecimals={allowDecimals} />
        <Tooltip content={makeTooltip(format, labelOf)} cursor={{ fill: 'var(--hover-wash)' }} isAnimationActive={false} />
        <Bar dataKey={yKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500} activeBar={{ fillOpacity: 0.82 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Line chart (1–2 series, one shared axis)
// ---------------------------------------------------------------------------

export function SimpleLineChart({
  data,
  xKey,
  series,
  format,
  tickFormat = niceTick,
  labelOf,
  height = 240,
}: {
  data: Row[];
  xKey: string;
  series: { key: string; name: string; color: string }[];
  format: Fmt;
  tickFormat?: Fmt;
  labelOf?: (row: Record<string, unknown>) => string;
  height?: number;
}) {
  const lastIndex = data.length - 1;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 52, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={AXIS_TICK} minTickGap={16} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={44} tickFormatter={tickFormat} domain={['auto', 'auto']} />
        <Tooltip content={makeTooltip(format, labelOf)} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls
            dot={data.length <= 40 ? { r: 4, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 } : false}
            activeDot={{ r: 5, fill: s.color, stroke: 'var(--surface)', strokeWidth: 2 }}
            animationDuration={500}
            label={(props: { x?: unknown; y?: unknown; index?: unknown; value?: unknown }) => {
              if (props.index !== lastIndex || typeof props.value !== 'number') return <g />;
              return (
                <text x={Number(props.x) + 9} y={Number(props.y) + 4} className="chart-end-label">
                  {tickFormat(props.value)}
                </text>
              );
            }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Stacked bar chart (≤ 4 series, fixed palette order, 2px surface gap)
// ---------------------------------------------------------------------------

export function StackedBarChart({
  data,
  xKey,
  series,
  format,
  labelOf,
  height = 240,
}: {
  data: Row[];
  xKey: string;
  series: { key: string; name: string; color: string }[];
  format: Fmt;
  labelOf?: (row: Record<string, unknown>) => string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={AXIS_TICK} minTickGap={8} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={AXIS_TICK} width={32} allowDecimals={false} />
        <Tooltip content={makeTooltip(format, labelOf)} cursor={{ fill: 'var(--hover-wash)' }} isAnimationActive={false} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="stack"
            fill={s.color}
            stroke="var(--surface)"
            strokeWidth={2}
            maxBarSize={26}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            animationDuration={500}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart (single series) with an optional reference value
// ---------------------------------------------------------------------------

export function HBarChart({
  data,
  labelKey,
  valueKey,
  name,
  format,
  max,
  reference,
  color = 'var(--series-1)',
  labelOf,
}: {
  data: Row[];
  labelKey: string;
  valueKey: string;
  name: string;
  format: Fmt;
  max: number;
  reference?: { value: number; label: string };
  color?: string;
  labelOf?: (row: Record<string, unknown>) => string;
}) {
  const height = Math.max(120, data.length * 40 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke="var(--grid)" />
        <XAxis type="number" domain={[0, max]} tickLine={false} axisLine={{ stroke: 'var(--axis)' }} tick={AXIS_TICK} tickFormatter={(v: number) => formatNumber(v, 1)} />
        <YAxis type="category" dataKey={labelKey} tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fill: 'var(--text-2)', fontSize: 12 }} width={150} />
        <Tooltip content={makeTooltip(format, labelOf)} cursor={{ fill: 'var(--hover-wash)' }} isAnimationActive={false} />
        {reference && (
          <ReferenceLine x={reference.value} stroke="var(--text-3)" strokeWidth={1} label={{ value: reference.label, position: 'top', fill: 'var(--text-3)', fontSize: 11 }} />
        )}
        <Bar
          dataKey={valueKey}
          name={name}
          fill={color}
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
          animationDuration={500}
          label={{ position: 'right', fill: 'var(--text-2)', fontSize: 12, fontWeight: 600, formatter: (v: unknown) => (typeof v === 'number' ? format(v) : '') }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
