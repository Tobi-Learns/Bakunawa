"use client";

// Market charts (1.9b/c). Hand-rolled SVG per the dataviz method:
// - rungs are ORDINAL -> one blue sequential ramp light->dark (validated
//   against the dark surface: all steps >= 3:1; identity also carried by a
//   legend + direct labels + table view, never color alone)
// - single-series charts use ramp step 400 (#3987e5); no legend (title names it)
// - 2px lines, recessive 1px grid, text in text tokens, crosshair tooltip,
//   <details> data table on every chart.

import { useMemo, useRef, useState } from "react";

/** Sequential blue ramp, shallow -> deep rung (dark-surface steps). */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf"];
export const ACCENT = "#3987e5";
const GRID = "#262626";
const W = 640;
const H = 200;
const PAD = { l: 46, r: 74, t: 10, b: 22 };

const rampColor = (i: number, n: number) =>
  RAMP[n <= 1 ? 3 : Math.round((i * (RAMP.length - 1)) / (n - 1))];

function fmtTime(t: number, spanSec: number): string {
  const d = new Date(t * 1000);
  return spanSec > 172_800
    ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface Scale {
  x: (t: number) => number;
  y: (v: number) => number;
  t0: number;
  t1: number;
  v0: number;
  v1: number;
}

function makeScale(ts: number[], vs: number[], padV = 0.08, clampZero = false): Scale {
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts, t0 + 1);
  let v0 = Math.min(...vs);
  let v1 = Math.max(...vs);
  if (v0 === v1) {
    v0 -= 1;
    v1 += 1;
  }
  const pad = (v1 - v0) * padV;
  v0 -= pad;
  v1 += pad;
  if (clampZero && v0 < 0) v0 = 0; // pool sizes / ROIs are never negative
  return {
    x: (t) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r),
    y: (v) => H - PAD.b - ((v - v0) / (v1 - v0)) * (H - PAD.t - PAD.b),
    t0, t1, v0, v1,
  };
}

/** Step-after path through (t, v) points. */
function stepPath(pts: { t: number; v: number }[], s: Scale): string {
  if (pts.length === 0) return "";
  let d = `M ${s.x(pts[0].t).toFixed(1)} ${s.y(pts[0].v).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` H ${s.x(pts[i].t).toFixed(1)} V ${s.y(pts[i].v).toFixed(1)}`;
  }
  d += ` H ${(W - PAD.r).toFixed(1)}`; // hold the last value to "now"
  return d;
}

function Frame({
  scale,
  yFmt,
  children,
}: {
  scale: Scale;
  yFmt: (v: number) => string;
  children: React.ReactNode;
}) {
  const yTicks = [0, 0.5, 1].map((f) => scale.v0 + f * (scale.v1 - scale.v0));
  const xTicks = [0, 0.5, 1].map((f) => scale.t0 + f * (scale.t1 - scale.t0));
  const span = scale.t1 - scale.t0;
  return (
    <>
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={scale.y(v)} y2={scale.y(v)} stroke={GRID} strokeWidth={1} />
          <text x={PAD.l - 6} y={scale.y(v) + 3} textAnchor="end" fontSize={10} fill="#737373">
            {yFmt(v)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={Math.min(Math.max(PAD.l, (t - scale.t0) / (scale.t1 - scale.t0) * (W - PAD.l - PAD.r) + PAD.l), W - PAD.r)} y={H - 6} textAnchor="middle" fontSize={10} fill="#737373">
          {fmtTime(t, span)}
        </text>
      ))}
      {children}
    </>
  );
}

/** Shared crosshair-hover plumbing: returns hovered index over `ts`. */
function useCrosshair(ts: number[], scale: Scale | null) {
  const [idx, setIdx] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const onMove = (e: React.PointerEvent) => {
    if (!scale || ts.length === 0 || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    ts.forEach((t, i) => {
      const d = Math.abs(scale.x(t) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setIdx(best);
  };
  return { idx, ref, onMove, onLeave: () => setIdx(null) };
}

function Tooltip({ x, lines }: { x: number; lines: string[] }) {
  const left = x > W * 0.6 ? undefined : `${(x / W) * 100}%`;
  const right = x > W * 0.6 ? `${100 - (x / W) * 100}%` : undefined;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 rounded border border-neutral-700 bg-neutral-900/95 px-2.5 py-1.5 text-xs text-neutral-200"
      style={{ left, right }}
    >
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "text-neutral-400" : ""}>
          {l}
        </div>
      ))}
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="mt-1 text-xs text-neutral-500">
      <summary className="cursor-pointer">Data table</summary>
      <div className="max-h-48 overflow-y-auto">
        <table className="mt-1 w-full">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="py-1 pr-3 text-left font-normal text-neutral-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-neutral-900">
                {r.map((c, j) => (
                  <td key={j} className="py-0.5 pr-3 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// --- 1. Pool growth ---

export function PoolChart({ points }: { points: { t: number; pool: string }[] }) {
  const data = points.map((p) => ({ t: p.t, v: Number(BigInt(p.pool)) / 1e7 }));
  const scale = useMemo(
    () => (data.length ? makeScale(data.map((d) => d.t), [0, ...data.map((d) => d.v)], 0.08, true) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points],
  );
  const { idx, ref, onMove, onLeave } = useCrosshair(data.map((d) => d.t), scale);
  if (!scale || data.length === 0)
    return <p className="text-xs text-neutral-600">No entries yet — the pool chart starts with the first prediction.</p>;
  const path = stepPath(data, scale);
  const areaPath = `${path} V ${scale.y(Math.max(0, scale.v0))} H ${scale.x(data[0].t)} Z`;
  return (
    <div className="relative">
      {idx !== null && (
        <Tooltip
          x={scale.x(data[idx].t)}
          lines={[fmtTime(data[idx].t, scale.t1 - scale.t0), `Pool ${data[idx].v.toFixed(2)} USDC`]}
        />
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" onPointerMove={onMove} onPointerLeave={onLeave}>
        <Frame scale={scale} yFmt={(v) => v.toFixed(0)}>
          <path d={areaPath} fill={ACCENT} opacity={0.12} />
          <path d={path} fill="none" stroke={ACCENT} strokeWidth={2} />
          {idx !== null && (
            <>
              <line x1={scale.x(data[idx].t)} x2={scale.x(data[idx].t)} y1={PAD.t} y2={H - PAD.b} stroke="#525252" strokeWidth={1} />
              <circle cx={scale.x(data[idx].t)} cy={scale.y(data[idx].v)} r={4} fill={ACCENT} stroke="#0a0a0a" strokeWidth={2} />
            </>
          )}
        </Frame>
      </svg>
      <DataTable
        head={["Time", "Pool (USDC)"]}
        rows={data.map((d) => [new Date(d.t * 1000).toLocaleString(), d.v.toFixed(2)])}
      />
    </div>
  );
}

// --- 2. Per-rung implied payout history ---

export interface SeriesPointDto {
  t: number;
  pool: string;
  quotes: { side: number; rung: number; roi: number | null }[];
}

export function RungHistoryChart({
  points,
  rungs,
  sideA,
  sideB,
  oracle,
}: {
  points: SeriesPointDto[];
  rungs: number[];
  sideA: string;
  sideB: string;
  oracle: string;
}) {
  const [side, setSide] = useState(0);
  const allRungs = useMemo(() => [0, ...rungs], [rungs]);
  const label = (r: number) =>
    r === 0 ? "Regular" : oracle === "Reflector" ? `≥${(r / 100).toFixed(r % 100 ? 2 : 0)}%` : `≥${r}`;

  const series = useMemo(
    () =>
      allRungs.map((rung, i) => ({
        rung,
        color: rampColor(i, allRungs.length),
        pts: points.map((p) => ({
          t: p.t,
          v: (p.quotes.find((q) => q.side === side && q.rung === rung)?.roi ?? 0) * 100,
        })),
      })),
    [points, allRungs, side],
  );
  const scale = useMemo(() => {
    const vs = series.flatMap((s) => s.pts.map((p) => p.v));
    return points.length
      ? makeScale(points.map((p) => p.t), vs.length ? vs : [0, 1], 0.08, true)
      : null;
  }, [series, points]);
  const { idx, ref, onMove, onLeave } = useCrosshair(points.map((p) => p.t), scale);

  if (!scale || points.length === 0)
    return <p className="text-xs text-neutral-600">No entries yet — rung prices appear with the first prediction.</p>;

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {[0, 1].map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                side === s ? "border-neutral-300 text-neutral-100" : "border-neutral-800 text-neutral-500"
              }`}
            >
              {s === 0 ? sideA : sideB}
            </button>
          ))}
        </div>
        {/* legend — identity never rides on color alone (labels also at line ends) */}
        <div className="flex flex-wrap gap-2.5 text-[10px] text-neutral-400">
          {series.map((s) => (
            <span key={s.rung} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {label(s.rung)}
            </span>
          ))}
        </div>
      </div>
      {idx !== null && (
        <Tooltip
          x={scale.x(points[idx].t)}
          lines={[
            fmtTime(points[idx].t, scale.t1 - scale.t0),
            ...series.map((s) => `${label(s.rung)}: +${s.pts[idx].v.toFixed(0)}%`),
          ]}
        />
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" onPointerMove={onMove} onPointerLeave={onLeave}>
        <Frame scale={scale} yFmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}>
          {series.map((s) => (
            <path key={s.rung} d={stepPath(s.pts, scale)} fill="none" stroke={s.color} strokeWidth={2} />
          ))}
          {/* direct labels at line ends */}
          {series.map((s) => (
            <text
              key={`l${s.rung}`}
              x={W - PAD.r + 4}
              y={scale.y(s.pts[s.pts.length - 1].v) + 3}
              fontSize={9}
              fill={s.color}
            >
              {label(s.rung)}
            </text>
          ))}
          {idx !== null && (
            <line x1={scale.x(points[idx].t)} x2={scale.x(points[idx].t)} y1={PAD.t} y2={H - PAD.b} stroke="#525252" strokeWidth={1} />
          )}
        </Frame>
      </svg>
      <DataTable
        head={["Time", ...series.map((s) => label(s.rung))]}
        rows={points.map((p, i) => [
          new Date(p.t * 1000).toLocaleString(),
          ...series.map((s) => `+${s.pts[i].v.toFixed(0)}%`),
        ])}
      />
    </div>
  );
}

// --- 3. Live price vs rung thresholds (crypto) ---

export function PriceChart({
  samples,
  baseline,
  rungs,
  sideA,
  sideB,
}: {
  samples: { ts: number; price: string }[];
  baseline: string;
  rungs: number[];
  sideA: string;
  sideB: string;
}) {
  const base = BigInt(baseline);
  const data = samples.map((s) => ({
    t: s.ts,
    v: base > 0n ? Number(((BigInt(s.price) - base) * 1_000_000n) / base) / 10_000 : 0, // % move
    price: Number(BigInt(s.price)) / 1e14,
  }));
  const maxRungPct = rungs.length ? rungs[rungs.length - 1] / 100 : 1;
  const scale = useMemo(() => {
    if (data.length === 0) return null;
    const absMax = Math.max(...data.map((d) => Math.abs(d.v)), maxRungPct * 0.4, 0.1);
    return makeScale(data.map((d) => d.t), [-absMax, absMax]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples]);
  const { idx, ref, onMove, onLeave } = useCrosshair(data.map((d) => d.t), scale);

  if (!scale || data.length === 0)
    return (
      <p className="text-xs text-neutral-600">
        No price samples in the window yet — they accumulate as the indexer runs.
      </p>
    );

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${scale.x(d.t).toFixed(1)} ${scale.y(d.v).toFixed(1)}`)
    .join(" ");

  const thresholds = rungs
    .flatMap((r) => [
      { v: r / 100, label: `${sideA} ≥${(r / 100).toFixed(r % 100 ? 2 : 0)}%` },
      { v: -r / 100, label: `${sideB} ≥${(r / 100).toFixed(r % 100 ? 2 : 0)}%` },
    ])
    .filter((th) => th.v > scale.v0 && th.v < scale.v1);

  return (
    <div className="relative">
      {idx !== null && (
        <Tooltip
          x={scale.x(data[idx].t)}
          lines={[
            fmtTime(data[idx].t, scale.t1 - scale.t0),
            `${data[idx].v >= 0 ? sideA : sideB} ${Math.abs(data[idx].v).toFixed(2)}%`,
            `$${data[idx].price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          ]}
        />
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" onPointerMove={onMove} onPointerLeave={onLeave}>
        <Frame scale={scale} yFmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={scale.y(0)} y2={scale.y(0)} stroke="#404040" strokeWidth={1} />
          {thresholds.map((th) => (
            <g key={th.label}>
              <line
                x1={PAD.l} x2={W - PAD.r} y1={scale.y(th.v)} y2={scale.y(th.v)}
                stroke="#525252" strokeWidth={1} strokeDasharray="4 4"
              />
              <text x={W - PAD.r + 4} y={scale.y(th.v) + 3} fontSize={9} fill="#737373">
                {th.label}
              </text>
            </g>
          ))}
          <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2} />
          {idx !== null && (
            <>
              <line x1={scale.x(data[idx].t)} x2={scale.x(data[idx].t)} y1={PAD.t} y2={H - PAD.b} stroke="#525252" strokeWidth={1} />
              <circle cx={scale.x(data[idx].t)} cy={scale.y(data[idx].v)} r={4} fill={ACCENT} stroke="#0a0a0a" strokeWidth={2} />
            </>
          )}
        </Frame>
      </svg>
      <DataTable
        head={["Time", "Move", "Price"]}
        rows={data.map((d) => [
          new Date(d.t * 1000).toLocaleString(),
          `${d.v >= 0 ? "+" : ""}${d.v.toFixed(2)}%`,
          `$${d.price.toFixed(2)}`,
        ])}
      />
    </div>
  );
}
