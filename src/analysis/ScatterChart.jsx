import { useRef, useState } from 'react'

// Each point is one batch: x = how far its process value sat from the product's own average, y = same for the result.
// The line is the least-squares fit through the origin of those deviations.
const W = 420, H = 240, PL = 46, PR = 12, PT = 12, PB = 34
const ext = (a) => { const m = Math.max(...a.map(Math.abs), 1e-9) * 1.15; return [-m, m] }
const fmt = (v, dp) => (Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '+' : '') + v.toFixed(dp))

export default function ScatterChart({ pts, xLabel, yLabel, dpX = 1, dpY = 3 }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const [x0, x1] = ext(pts.map((p) => p.dx)), [y0, y1] = ext(pts.map((p) => p.dy))
  const X = (v) => PL + ((v - x0) / (x1 - x0)) * (W - PL - PR), Y = (v) => PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB)
  const sxx = pts.reduce((s, p) => s + p.dx * p.dx, 0), sxy = pts.reduce((s, p) => s + p.dx * p.dy, 0)
  const slope = sxx > 0 ? sxy / sxx : 0
  const near = (e) => {
    const r = ref.current.getBoundingClientRect(), c = e.touches ? e.touches[0] : e
    const x = ((c.clientX - r.left) / r.width) * W, y = ((c.clientY - r.top) / r.height) * H
    let best = null, bd = 1e9
    for (const p of pts) { const d = (X(p.dx) - x) ** 2 + (Y(p.dy) - y) ** 2; if (d < bd) { bd = d; best = p } }
    setHover(bd < 28 ** 2 ? best : null)
  }
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={`${yLabel} เทียบกับ ${xLabel}`} onMouseMove={near} onMouseLeave={() => setHover(null)} onTouchStart={near}>
        <line x1={PL} x2={W - PR} y1={Y(0)} y2={Y(0)} stroke="var(--viz-grid)" /><line x1={X(0)} x2={X(0)} y1={PT} y2={H - PB} stroke="var(--viz-grid)" />
        <line x1={X(x0)} y1={Y(slope * x0)} x2={X(x1)} y2={Y(slope * x1)} stroke="var(--viz-muted)" strokeWidth="1.5" />
        {pts.map((p, i) => <circle key={i} cx={X(p.dx)} cy={Y(p.dy)} r={hover === p ? 6 : 4.5} fill="var(--viz-s1)" fillOpacity="0.85" stroke="var(--viz-surface)" strokeWidth="2" />)}
        <text x={PL - 6} y={PT + 8} textAnchor="end" fontSize="10" fill="var(--viz-muted)">{fmt(y1, dpY)}</text>
        <text x={PL - 6} y={H - PB} textAnchor="end" fontSize="10" fill="var(--viz-muted)">{fmt(y0, dpY)}</text>
        <text x={PL} y={H - PB + 13} fontSize="10" fill="var(--viz-muted)">{fmt(x0, dpX)}</text>
        <text x={W - PR} y={H - PB + 13} textAnchor="end" fontSize="10" fill="var(--viz-muted)">{fmt(x1, dpX)}</text>
        <text x={(PL + W - PR) / 2} y={H - 4} textAnchor="middle" fontSize="10.5" fill="var(--viz-text)">{xLabel} (ต่างจากค่าเฉลี่ยของผลิตภัณฑ์)</text>
        <text x={PL + 6} y={PT + 10} fontSize="10.5" fill="var(--viz-text)">↑ {yLabel} (ต่างจากค่าเฉลี่ยของผลิตภัณฑ์)</text>
      </svg>
      {hover && <div className="absolute z-10 pointer-events-none text-[11px] leading-tight rounded-lg px-2 py-1.5 shadow-lg border" style={{ left: `${Math.min(62, Math.max(2, (X(hover.dx) / W) * 100 - 10))}%`, top: 0, background: 'var(--viz-surface)', borderColor: 'var(--viz-grid)', color: 'var(--viz-text)' }}>
        <b>{hover.b.name}</b><br />Batch {hover.b.batch_no}<br />{xLabel}: {hover.x.toFixed(dpX)} · {yLabel}: {hover.y.toFixed(dpY)}</div>}
    </div>
  )
}
