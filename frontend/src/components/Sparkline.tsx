"use client";

import { useRef, useState } from "react";

interface SparklineProps {
  values: number[];
  color?: string;
  width?: number;
  /** Normal operating band — shaded as a reference on the chart */
  band?: { lower: number; upper: number };
}

// Layout constants
const TIP_H  = 24;   // tooltip zone height at top
const TIP_GAP = 3;   // gap between tooltip and chart
const CHART_H = 36;  // chart line area height
const TOTAL_H = TIP_H + TIP_GAP + CHART_H;
const PAD_L   = 2;
const PAD_R   = 8;   // right padding so endpoint dot isn't clipped

export function Sparkline({ values, color = "#0ea5e9", width = 140, band }: SparklineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  if (!values || values.length < 2) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  const innerW  = width - PAD_L - PAD_R;
  const chartT  = TIP_H + TIP_GAP;          // where the chart area starts (Y)
  const chartB  = chartT + CHART_H;          // bottom of chart area (Y)

  // Y domain includes band so it doesn't clip outside chart area
  const allMin  = Math.min(...values);
  const allMax  = Math.max(...values);
  const domLo   = band ? Math.min(allMin, band.lower * 0.97) : allMin;
  const domHi   = band ? Math.max(allMax, band.upper * 1.03) : allMax;
  const span    = domHi - domLo || 1;

  const xOf = (i: number) => PAD_L + (i / (values.length - 1)) * innerW;
  const yOf = (v: number) => chartB - ((v - domLo) / span) * CHART_H;

  // SVG path data
  const points  = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
  const areaD   = [
    `M ${xOf(0).toFixed(1)} ${chartB}`,
    ...values.map((v, i) => `L ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`),
    `L ${xOf(values.length - 1).toFixed(1)} ${chartB}`,
    "Z",
  ].join(" ");

  // Hovered point
  const hi    = hovered;
  const hx    = hi !== null ? xOf(hi) : null;
  const hy    = hi !== null ? yOf(values[hi]) : null;
  const hVal  = hi !== null ? values[hi] : null;
  const hTime = hi !== null ? (hi === values.length - 1 ? "now" : `${values.length - 1 - hi}h ago`) : null;

  // Tooltip box — 68 wide, centred on hx, clamped to SVG bounds
  const TW    = 72;
  const txRaw = hx !== null ? hx - TW / 2 : 0;
  const tx    = Math.max(0, Math.min(width - TW, txRaw));

  // Normal band Y positions (within chart area)
  const bandY1 = band ? yOf(band.upper) : null;
  const bandY2 = band ? yOf(band.lower) : null;

  const gradId = `sg-${color.replace(/[^a-z0-9]/gi, "")}`;
  const bandId = `sb-${color.replace(/[^a-z0-9]/gi, "")}`;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD_L) / innerW));
    setHovered(Math.round(frac * (values.length - 1)));
  }

  return (
    <svg
      ref={svgRef}
      width={width}
      height={TOTAL_H}
      className="block cursor-crosshair"
      style={{ overflow: "visible" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHovered(null)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#10b981" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* Normal band shading */}
      {band && bandY1 !== null && bandY2 !== null && (
        <rect
          x={PAD_L} y={bandY1}
          width={innerW} height={Math.max(0, bandY2 - bandY1)}
          fill={`url(#${bandId})`}
          stroke="#10b981" strokeWidth={0.6} strokeDasharray="3 3" strokeOpacity={0.45}
        />
      )}

      {/* Area fill */}
      <path d={areaD} fill={`url(#${gradId})`} />

      {/* Crosshair */}
      {hx !== null && (
        <line
          x1={hx} x2={hx} y1={chartT} y2={chartB}
          stroke={color} strokeWidth={1} strokeDasharray="3 2" opacity={0.55}
        />
      )}

      {/* Line */}
      <polyline
        points={points}
        fill="none" stroke={color} strokeWidth={1.6}
        strokeLinejoin="round" strokeLinecap="round"
      />

      {/* Endpoint dot */}
      <circle cx={xOf(values.length - 1)} cy={yOf(values[values.length - 1])} r={2.5} fill={color} />

      {/* Hover dot */}
      {hx !== null && hy !== null && (
        <>
          <circle cx={hx} cy={hy} r={5.5} fill="white" fillOpacity={0.9} />
          <circle cx={hx} cy={hy} r={3.5} fill={color} />
        </>
      )}

      {/* ── Tooltip — rendered in the TOP zone of the SVG (y: 0 → TIP_H) ── */}
      {hx !== null && hVal !== null && (
        <g transform={`translate(${tx}, 1)`}>
          {/* shadow */}
          <rect x={1} y={1} width={TW} height={TIP_H - 2} rx={5} fill="black" fillOpacity={0.12} />
          {/* box */}
          <rect x={0} y={0} width={TW} height={TIP_H - 2} rx={5}
            fill="#1e293b" />
          {/* caret pointing DOWN toward the chart line */}
          <polygon
            points={`${Math.min(TW - 6, Math.max(6, hx - tx + TW / 2 - TW / 2))},${TIP_H - 2} ${Math.min(TW - 6, Math.max(6, hx - tx + TW / 2 - TW / 2)) + 7},${TIP_H - 2} ${Math.min(TW - 6, Math.max(6, hx - tx + TW / 2 - TW / 2)) + 3.5},${TIP_H + 2}`}
            fill="#1e293b"
          />
          {/* time label */}
          <text x={8} y={15} fontSize={9} fill="#94a3b8" fontFamily="ui-monospace,monospace">
            {hTime}
          </text>
          {/* value */}
          <text x={TW - 7} y={15} fontSize={10} fontWeight="700" fill="white"
            textAnchor="end" fontFamily="ui-monospace,monospace">
            {hVal.toFixed(1)}
          </text>
        </g>
      )}
    </svg>
  );
}
