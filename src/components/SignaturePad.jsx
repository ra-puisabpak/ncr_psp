import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

// A box to sign in with a finger or a mouse. onChange gets a PNG data URL after each stroke, or null once cleared.
export default function SignaturePad({ onChange, resetKey }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)
  const clear = () => {
    const c = ref.current; if (!c) return
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true); onChange(null)
  }
  useEffect(() => { clear() }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const point = (e) => {
    const c = ref.current, r = c.getBoundingClientRect()
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height]
  }
  const down = (e) => {
    e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true
    const ctx = ref.current.getContext('2d'); const [x, y] = point(e)
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a'
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke()
  }
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext('2d'); const [x, y] = point(e); ctx.lineTo(x, y); ctx.stroke() }
  const up = () => {
    if (!drawing.current) return
    drawing.current = false; setEmpty(false); onChange(ref.current.toDataURL('image/png'))
  }
  return (
    <div>
      <div className="relative border-2 border-dashed border-gray-300 rounded-lg bg-white">
        <canvas ref={ref} width={700} height={200} className="w-full h-32 touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        {empty && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300 pointer-events-none">เซ็นชื่อที่นี่</div>}
      </div>
      <button type="button" onClick={clear} className="mt-1 text-xs text-gray-500 flex items-center gap-1"><Eraser className="w-3.5 h-3.5" />ล้างลายเซ็น</button>
    </div>
  )
}
