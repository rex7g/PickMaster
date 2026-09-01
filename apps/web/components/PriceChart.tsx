"use client";

/**
 * Gráfico de probabilidad del mercado (§37, §55): dos series complementarias
 * SÍ/NO con etiquetas directas al final de línea, crosshair con tooltip y
 * rangos 1H–ALL. Colores validados para visión de color (ΔE deutan 15.2):
 * SÍ #2dd4bf, NO #f43f5e; identidad reforzada con etiquetas directas.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface Point {
  t: number;
  yes: number;
}

const RANGES = ["1H", "6H", "1D", "1W", "1M", "ALL"] as const;
type Range = (typeof RANGES)[number];

const YES_COLOR = "#2dd4bf";
const NO_COLOR = "#f43f5e";

const W = 800;
const H = 280;
const PAD = { top: 16, right: 56, bottom: 26, left: 8 };

export function PriceChart({
  marketId,
  yesLabel = "SÍ",
  noLabel = "NO",
}: {
  marketId: string;
  yesLabel?: string;
  noLabel?: string;
}) {
  const [range, setRange] = useState<Range>("1W");
  const [points, setPoints] = useState<Point[]>([]);
  const [volume, setVolume] = useState(0);
  const [hover, setHover] = useState<number | null>(null); // index into points
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/markets/${marketId}/history?range=${range}`);
    if (!res.ok) return;
    const data = await res.json();
    setPoints(data.points ?? []);
    setVolume(data.volumeCents ?? 0);
  }, [marketId, range]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (points.length < 2) {
    return <div className="h-[280px] flex items-center justify-center text-slate-600 text-sm">Cargando gráfico…</div>;
  }

  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p / 100) * (H - PAD.top - PAD.bottom);

  const path = (series: (p: Point) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(series(p)).toFixed(1)}`).join("");

  const yesPath = path((p) => p.yes);
  const noPath = path((p) => 100 - p.yes);

  const last = points[points.length - 1]!;
  const gridLevels = [20, 35, 50, 65, 80];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const target = t0 + ((px - PAD.left) / (W - PAD.left - PAD.right)) * (t1 - t0);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i]!.t - target);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHover(best);
  };

  const hp = hover !== null ? points[hover]! : null;
  const fmtTime = (t: number) =>
    new Date(t).toLocaleString("es-DO", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {/* Leyenda: identidad por chip de color + texto en tokens de texto */}
        <div className="flex items-center gap-4 text-xs text-slate-300">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: YES_COLOR }} />
            {yesLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: NO_COLOR }} />
            {noLabel}
          </span>
        </div>
        <span className="text-xs text-slate-500">Vol. ${(volume / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-[280px] touch-none select-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Probabilidad ${yesLabel} ${last.yes}%, ${noLabel} ${(100 - last.yes).toFixed(0)}%`}
        >
          {/* Grid recesivo + eje % a la derecha */}
          {gridLevels.map((g) => (
            <g key={g}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="#1e293b" strokeWidth="1" />
              <text x={W - PAD.right + 8} y={y(g) + 4} fontSize="11" fill="#64748b">
                {g}%
              </text>
            </g>
          ))}

          {/* Series: 2px, sin relleno */}
          <path d={noPath} fill="none" stroke={NO_COLOR} strokeWidth="2" strokeLinejoin="round" />
          <path d={yesPath} fill="none" stroke={YES_COLOR} strokeWidth="2" strokeLinejoin="round" />

          {/* Etiquetas directas al final de línea */}
          <circle cx={x(last.t)} cy={y(last.yes)} r="4" fill={YES_COLOR} stroke="#0b1120" strokeWidth="2" />
          <circle cx={x(last.t)} cy={y(100 - last.yes)} r="4" fill={NO_COLOR} stroke="#0b1120" strokeWidth="2" />

          {/* Crosshair */}
          {hp && (
            <g>
              <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={H - PAD.bottom} stroke="#475569" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={x(hp.t)} cy={y(hp.yes)} r="4.5" fill={YES_COLOR} stroke="#0b1120" strokeWidth="2" />
              <circle cx={x(hp.t)} cy={y(100 - hp.yes)} r="4.5" fill={NO_COLOR} stroke="#0b1120" strokeWidth="2" />
            </g>
          )}

          {/* Eje temporal */}
          <text x={PAD.left} y={H - 8} fontSize="11" fill="#64748b">
            {fmtTime(t0)}
          </text>
          <text x={W - PAD.right} y={H - 8} fontSize="11" fill="#64748b" textAnchor="end">
            {fmtTime(t1)}
          </text>
        </svg>

        {/* Etiquetas de fin de línea (HTML para tipografía nítida) */}
        <div
          className="absolute right-0 text-xs font-semibold pointer-events-none"
          style={{ top: `${((y(last.yes) - 10) / H) * 100}%` }}
        >
          <span className="rounded bg-slate-900/90 px-1.5 py-0.5 border border-slate-700 text-slate-200">
            {yesLabel} <span style={{ color: YES_COLOR }}>{last.yes.toFixed(0)}%</span>
          </span>
        </div>
        <div
          className="absolute right-0 text-xs font-semibold pointer-events-none"
          style={{ top: `${((y(100 - last.yes) - 10) / H) * 100}%` }}
        >
          <span className="rounded bg-slate-900/90 px-1.5 py-0.5 border border-slate-700 text-slate-200">
            {noLabel} <span style={{ color: NO_COLOR }}>{(100 - last.yes).toFixed(0)}%</span>
          </span>
        </div>

        {/* Tooltip */}
        {hp && (
          <div
            className="absolute pointer-events-none rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl"
            style={{
              left: `min(max(${(x(hp.t) / W) * 100}%, 8%), 70%)`,
              top: 4,
            }}
          >
            <div className="text-slate-400 mb-1">{fmtTime(hp.t)}</div>
            <div className="flex items-center gap-1.5 text-slate-200">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: YES_COLOR }} />
              {yesLabel} {hp.yes.toFixed(1)}%
            </div>
            <div className="flex items-center gap-1.5 text-slate-200">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: NO_COLOR }} />
              {noLabel} {(100 - hp.yes).toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {/* Filtro de rango, fila única */}
      <div className="flex justify-end gap-1 mt-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded px-2 py-1 text-xs font-medium ${
              range === r ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
