import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'

const MAX_SIDE = 1600
const MAX_BYTES = 900 * 1024

// Shrinks a phone photo in the browser so it uploads quickly and stays under the server limit.
export async function compressImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('เปิดไฟล์ภาพไม่ได้'))
      i.src = url
    })
    let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    for (let quality = 0.82; ; quality -= 0.12, scale *= 0.85) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', Math.max(quality, 0.4))
      const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
      if (bytes <= MAX_BYTES || quality < 0.3) {
        if (bytes > MAX_BYTES) throw new Error('ภาพใหญ่เกินไป กรุณาเลือกภาพอื่น')
        return { content_type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: dataUrl }
      }
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Shows one stored photo. `load` returns a Blob (the image needs the login or the supplier token to fetch).
export function PhotoThumb({ load, onRemove }) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let url = null, alive = true
    load().then((blob) => { if (!alive) return; url = URL.createObjectURL(blob); setSrc(url) }).catch(() => alive && setFailed(true))
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [])
  return (
    <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
      {src ? (
        <a href={src} target="_blank" rel="noreferrer"><img src={src} alt="ภาพประกอบ NCR" className="w-full h-full object-cover" /></a>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">{failed ? 'โหลดภาพไม่ได้' : 'กำลังโหลด...'}</div>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="ลบภาพ"
          className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1"><X className="w-4 h-4" /></button>
      )}
    </div>
  )
}

/**
 * Photo picker for the NCR form.
 * - Saved NCR (`api` given): photos upload at once and come from the server.
 * - New NCR (no `api`): photos wait in `pending` and the page uploads them right after the first save.
 */
export default function PhotoSection({ api, readOnly, pending = [], setPending, max = 8, only = 'internal', hint, hideWhenEmpty }) {
  const [all, setPhotos] = useState([])
  const photos = all.filter((p) => (p.source || 'internal') === only)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)

  const reload = () => api.list().then(setPhotos).catch((e) => setError(e.message))
  useEffect(() => { if (api) reload() }, [])

  const count = api ? photos.length : pending.length
  const pick = async (e) => {
    const files = [...e.target.files].slice(0, Math.max(0, max - count))
    e.target.value = ''
    if (!files.length) return
    setBusy(true); setError(null)
    try {
      for (const f of files) {
        const img = await compressImage(f)
        if (api) await api.upload({ content_type: img.content_type, data: img.data })
        else setPending((p) => [...p, img])
      }
      if (api) await reload()
    } catch (err) {
      setError(err.message)
      if (api) await reload()
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id) => {
    if (!window.confirm('ลบภาพนี้ออกจาก NCR ?')) return
    setError(null)
    try { await api.remove(id); await reload() } catch (err) { setError(err.message) }
  }

  if (hideWhenEmpty && count === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {hideWhenEmpty && <span className="text-xs font-medium text-gray-600">{hideWhenEmpty}</span>}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {api && photos.map((p) => (
          <PhotoThumb key={p.id} load={() => api.blob(p.id)} onRemove={readOnly ? null : () => remove(p.id)} />
        ))}
        {!api && pending.map((p, i) => (
          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
            <img src={p.preview} alt="ภาพที่เลือก" className="w-full h-full object-cover" />
            <button type="button" aria-label="ลบภาพ" onClick={() => setPending((list) => list.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {!readOnly && count < max && (
          <button type="button" disabled={busy} onClick={() => input.current?.click()}
            className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-500 text-xs disabled:opacity-50">
            <Camera className="w-6 h-6" />
            {busy ? 'กำลังอัปโหลด...' : 'เพิ่มภาพ'}
          </button>
        )}
      </div>
      {!readOnly && <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={pick} />}
      {readOnly && count === 0 && <div className="text-sm text-gray-400">ไม่มีภาพ</div>}
      {!readOnly && <div className="text-[11px] text-gray-400">{hint || `ถ่ายใหม่หรือเลือกจากคลังภาพ สูงสุด ${max} ภาพ ระบบย่อขนาดให้อัตโนมัติ ผู้ส่งมอบจะเห็นภาพเหล่านี้เมื่อเปิดลิงก์ตอบกลับ`}</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  )
}
