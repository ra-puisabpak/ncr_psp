import { useRef, useState } from 'react'

// One-series trend line on a single y-axis. points: [{ t (ms), y, bad?, tip }]; band: [min, max] draws the allowed range.
// Out-of-range points are drawn as a triangle (shape, not colour alone) and the tooltip says so.
const W = 640, PL = 42, PR = 12, PT = 16, PB = 22
const nice = (lo, hi) => {
  const span = hi - lo || 1, step = Math.pow(10, Math.floor(Math.log10(span / 3)))
  const k = [1, 2, 5, 10].find((m) => span / (step * m) <= 4) * step
  return { lo: Math.floor(lo / k) * k, hi: Math.ceil(hi / k) * k, k }
}
const fmtDay = (t) => { const d = new Date(t); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` }

export default function TrendChart({ points, band, unit = '', dp = 1, height = 150, label }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  if (!points.length) return <div className="text-xs text-gray-400 py-6 text-center">ไม่มีข้อมูลในช่วงนี้</div>
  const H = height
  const ys = points.map((p) => p.y).concat(band || [])
  const { lo, hi, k } = nice(Math.min(...ys), Math.max(...ys))
  const t0 = Math.min(...points.map((p) => p.t)), t1 = Math.max(...points.map((p) => p.t))
  const X = (t) => PL + (t1 === t0 ? (W - PL - PR) / 2 : ((t - t0) / (t1 - t0)) * (W - PL - PR))
  const Y = (y) => PT + (1 - (y - lo) / (hi - lo)) * (H - PT - PB)
  const tickDp = Math.max(0, Math.min(4, -Math.floor(Math.log10(k) + 1e-9)))
  const ticks = []; for (let v = lo; v <= hi + k / 2; v += k) ticks.push(+v.toFixed(6))
  const sorted = [...points].sort((a, b) => a.t - b.t)
  const path = sorted.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const last = sorted[sorted.length - 1]
  const dayTicks = [t0, (t0 + t1) / 2, t1].filter((v, i, a) => i === 0 || v !== a[i - 1])
  const move = (e) => {
    const r = ref.current.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    let best = null, bd = 1e9
    for (const p of sorted) { const d = Math.abs(X(p.t) - x); if (d < bd) { bd = d; best = p } }
    setHover(best)
  }
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block touch-pan-y" role="img" aria-label={label} onMouseMove={move} onMouseLeave={() => setHover(null)} onTouchStart={(e) => move(e.touches[0])} onTouchMove={(e) => move(e.touches[0])}>
        {band && <rect x={PL} width={W - PL - PR} y={Y(band[1])} height={Math.max(0, Y(band[0]) - Y(band[1]))} fill="var(--viz-band)" />}
        {ticks.map((v) => (
          <g key={v}><line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke="var(--viz-grid)" strokeWidth="1" /><text x={PL - 6} y={Y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--viz-muted)">{v.toFixed(tickDp)}</text></g>
        ))}
        {dayTicks.map((t, i) => <text key={t} x={X(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === dayTicks.length - 1 && dayTicks.length > 1 ? 'end' : 'middle'} fontSize="10" fill="var(--viz-muted)">{fmtDay(t)}</text>)}
        <path d={path} fill="none" stroke="var(--viz-s1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {sorted.map((p, i) => p.bad
          ? <path key={i} d={`M${X(p.t)},${Y(p.y) - 5.5} l5,9 h-10 z`} fill="var(--viz-bad)" stroke="var(--viz-surface)" strokeWidth="2" />
          : <circle key={i} cx={X(p.t)} cy={Y(p.y)} r={sorted.length > 40 ? 2.5 : 4} fill="var(--viz-s1)" stroke="var(--viz-surface)" strokeWidth="2" />)}
        <text x={Math.min(X(last.t) + 6, W - PR)} y={Math.max(PT - 2, Y(last.y) - 8)} textAnchor={X(last.t) > W - 60 ? 'end' : 'start'} fontSize="11" fontWeight="600" fill="var(--viz-text)">{last.y.toFixed(dp)}{unit}</text>
        {hover && <g pointerEvents="none"><line x1={X(hover.t)} x2={X(hover.t)} y1={PT} y2={H - PB} stroke="var(--viz-muted)" strokeWidth="1" /><circle cx={X(hover.t)} cy={Y(hover.y)} r="5" fill={hover.bad ? 'var(--viz-bad)' : 'var(--viz-s1)'} stroke="var(--viz-surface)" strokeWidth="2" /></g>}
      </svg>
      {hover && (
        <div className="absolute z-10 pointer-events-none text-[11px] leading-tight rounded-lg px-2 py-1.5 shadow-lg border" style={{ left: `${Math.min(86, Math.max(2, (X(hover.t) / W) * 100 - 8))}%`, top: -4, background: 'var(--viz-surface)', borderColor: 'var(--viz-grid)', color: 'var(--viz-text)' }}>
          <b>{hover.y.toFixed(dp)}{unit}</b>{hover.bad ? <span style={{ color: 'var(--viz-bad)' }}> ▲ นอกเกณฑ์</span> : null}<br />{hover.tip}
        </div>
      )}
    </div>
  )
}
