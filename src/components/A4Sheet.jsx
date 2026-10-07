import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const MM = 96 / 25.4
const WJ = '⁠' // word joiner: no line break between the characters around it

// Short words (batch numbers, names, units) must never be split across two lines; long phrases keep the browser's own Thai word breaking.
function keepWordsWhole(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  for (const n of nodes) {
    const t = n.nodeValue
    if (!t || t.includes(WJ) || !t.trim()) continue
    const next = t.split(/(\s+)/).map((tok) => (tok.trim() && [...tok].length <= 16 ? [...tok].join(WJ) : tok)).join('')
    if (next !== t) n.nodeValue = next
  }
}

// A real A4 sheet on screen (210 x 297 mm, or 297 x 210 landscape) with the print margin as padding, so what is on screen
// wraps exactly as it prints and a screenshot is a true A4 page. On a narrow screen the whole sheet is scaled down, never re-flowed.
export default function A4Sheet({ landscape = false, margin = 8, className = '', children }) {
  const ref = useRef(null)
  const w = (landscape ? 297 : 210) * MM
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 16) / w))
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [w])
  useLayoutEffect(() => { if (ref.current) keepWordsWhole(ref.current) })
  return (
    <div className="a4-stage">
      <div ref={ref} className={`print-area a4-sheet text-black ${className}`}
        style={{ width: `${landscape ? 297 : 210}mm`, minHeight: `${landscape ? 210 : 297}mm`, padding: `${margin}mm`, zoom, fontFamily: "'Sarabun', sans-serif" }}>
        {children}
      </div>
    </div>
  )
}
