import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, Printer, PackageSearch, CheckCircle2, XCircle } from 'lucide-react'
import Layout from '../components/Layout'
import { fgCheckApi, weighApi } from '../api/d1Api'
import { useAuth, canWrite } from '../auth'
import { PRODUCTS } from '../data/masterData'
import { ResultBadge, bkkToday, addDays, newUid } from '../qa/shared'
import { FORMS } from '../config'

const input = 'w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100'
export const FG_SENSORY = [['appearance', 'ลักษณะภายนอก'], ['color', 'สี'], ['odor', 'กลิ่น'], ['taste', 'รสชาติ']]
export const FG_PACK = [['pack_ok', 'สภาพบรรจุภัณฑ์ (สะอาด ไม่ชำรุด)'], ['seal_ok', 'การปิดผนึก'], ['label_ok', 'ฉลากถูกต้อง (ชื่อ อย. วันผลิต/หมดอายุ)']]
const blankForm = () => ({ product_code: '', batch_no: '', pack_key: '', packs: [], gross: ['', ''], recheck: [], sensory: {}, pack: {}, aw: '', aw_temp: '', ph: '', store_temp: '', store_area: '', note: '' })

function PassFail({ value, onChange }) {
  return (
    <div className="flex gap-1">
      <button type="button" onClick={() => onChange(true)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${value === true ? 'bg-green-600 text-white border-green-600' : 'bg-white border-gray-300 text-gray-600'}`}>ผ่าน</button>
      <button type="button" onClick={() => onChange(false)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${value === false ? 'bg-red-600 text-white border-red-600' : 'bg-white border-gray-300 text-gray-600'}`}>ไม่ผ่าน</button>
    </div>
  )
}

// FM-QC-008: one entry per product batch. The pack size is chosen first; its jar weight is deducted from every gross weight.
export default function FGCheckPage() {
  const { user } = useAuth()
  const [date, setDate] = useState(bkkToday())
  const [sizes, setSizes] = useState([])
  const [batches, setBatches] = useState([])
  const [f, setF] = useState(blankForm)
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [rows, setRows] = useState([])
  const [plan, setPlan] = useState({ packs: [], checked: [] }) // sizes this batch is filled into / already checked
  const [pending, setPending] = useState(null) // batches made the day before that still need this check
  const load = () => fgCheckApi.list({ from: date, to: date }).then(setRows).catch((e) => setError(e.message))
  useEffect(() => { fgCheckApi.packSizes().then((l) => setSizes(l.filter((x) => x.active))).catch((e) => setError(e.message)) }, [])
  useEffect(() => { load() }, [date])
  useEffect(() => { fgCheckApi.pending(date).then(setPending).catch(() => setPending(null)) }, [date, saved])
  useEffect(() => {
    if (!f.product_code) { setBatches([]); return }
    weighApi.list({ product_code: f.product_code, from: addDays(date, -30), to: date }).then((l) => setBatches([...new Set(l.map((w) => w.batch_no))])).catch(() => setBatches([]))
  }, [f.product_code, date])

  useEffect(() => {
    if (!f.product_code || !f.batch_no.trim()) { setPlan({ packs: [], checked: [] }); return }
    let live = true
    fgCheckApi.plan(f.product_code, f.batch_no.trim()).then((p) => { if (!live) return; setPlan(p); setF((x) => (x.checked_for === `${x.product_code}|${x.batch_no}` ? x : { ...x, checked_for: `${x.product_code}|${x.batch_no}`, packs: [...new Set([...p.packs, ...(x.pack_key ? [x.pack_key] : [])])], pack_key: p.checked.includes(x.pack_key) ? '' : x.pack_key })) }).catch(() => {})
    return () => { live = false }
  }, [f.product_code, f.batch_no, saved])
  const label = (k) => sizes.find((s) => s.pack_key === k)?.label_net_g
  const pk = sizes.find((x) => x.pack_key === f.pack_key)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const netOf = (g) => (pk && g !== '' && Number.isFinite(Number(g)) ? Math.round((Number(g) - pk.tare_g) * 100) / 100 : null)
  const nets = f.gross.map(netOf)
  // A jar under the label weight is weighed again; the re-check decides.
  const short = nets.map((n) => n !== null && n < pk.label_net_g)
  const reNets = f.gross.map((_, i) => (short[i] ? netOf(f.recheck[i] ?? '') : null))
  const failsNow = [
    ...reNets.filter((n, i) => short[i] && n !== null && n < pk.label_net_g).map((n) => `ชั่งซ้ำแล้วน้ำหนักสุทธิ ${n} g ยังต่ำกว่า ${pk.label_net_g} g`),
    ...FG_SENSORY.filter(([k]) => f.sensory[k] === false).map(([, l]) => `${l} ไม่ผ่าน`),
    ...FG_PACK.filter(([k]) => f.pack[k] === false).map(([, l]) => `${l} ไม่ผ่าน`),
  ]
  const complete = f.product_code && f.batch_no.trim() && pk && nets.filter((n) => n !== null).length >= 2 && short.every((x, i) => !x || reNets[i] !== null)
    && FG_SENSORY.every(([k]) => typeof f.sensory[k] === 'boolean') && FG_PACK.every(([k]) => typeof f.pack[k] === 'boolean')
    && (!failsNow.length || f.note.trim())

  const voidRow = async (r) => {
    const reason = window.prompt(`ยกเลิกรายการ ${r.fc_id} (${r.product_name || r.product_code} ${r.batch_no} · ${r.label_net_g} g)\nระบุเหตุผล:`)
    if (!reason || !reason.trim()) return
    try { await fgCheckApi.void(r.fc_id, reason.trim()); load(); fgCheckApi.pending(date).then(setPending).catch(() => {}); setSaved(null) } catch (e) { setError(e.message) }
  }
  const save = async () => {
    setSaving(true); setError(null)
    try {
      const p = PRODUCTS.find((x) => x.code === f.product_code)
      const res = await fgCheckApi.save({ uid, check_date: date, ...f, packs: [...new Set([...f.packs, f.pack_key])], recheck: f.gross.map((_, i) => (short[i] ? f.recheck[i] : null)), product_name: p?.label || '' })
      setSaved(res); setUid(newUid()); setF((x) => ({ ...blankForm(), store_area: x.store_area, store_temp: x.store_temp })); load()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><PackageSearch className="w-5 h-5 text-emerald-600" />ตรวจสอบผลิตภัณฑ์สุดท้าย</h1>
          <div className="text-xs text-gray-500">{FORMS.FG_CHECK.code} Rev.{FORMS.FG_CHECK.rev} · ต่อ Batch · เลือกขนาดบรรจุก่อน ระบบหักน้ำหนักกระปุกให้</div>
        </div>
        <Link to={`/qa/fgcheck/report?date=${date}`} className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Printer className="w-4 h-4" />รายงาน A4</Link>
      </div>

      {saved && (
        <div className={`rounded-xl p-3 mb-4 text-sm font-semibold flex items-start gap-2 ${saved.result === 'PASS' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {saved.result === 'PASS' ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          <span>บันทึก {saved.fc_id} — {saved.result === 'PASS' ? 'ผ่าน' : 'ไม่ผ่าน'} · น้ำหนักสุทธิ {saved.net?.map((n, i) => (saved.recheck?.[i] ? `${n}→${saved.recheck[i].net}` : n)).join(' / ')} g{saved.failed?.length ? <span className="block font-normal">{saved.failed.join(' · ')}</span> : null}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 space-y-3 mb-4">
        {pending && (
          <div className={`rounded-lg border p-2.5 ${pending.pending.length ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
            <div className="text-xs font-semibold text-gray-800">
              ตรวจ FG ที่ผลิตล่าสุด{pending.produced_on ? ` (${pending.produced_on.slice(8)}/${pending.produced_on.slice(5, 7)})` : ''} — {pending.pending.length ? `รอตรวจ ${pending.pending.length} จาก ${pending.made} Batch · แตะเพื่อเลือก` : pending.made ? `ตรวจครบแล้ว ${pending.made} Batch` : 'ยังไม่มีวันผลิตก่อนหน้า'}
            </div>
            {pending.pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {pending.pending.map((b) => (
                  <button key={`${b.product_code}-${b.batch_no}`} type="button" onClick={() => setF((x) => ({ ...x, product_code: b.product_code, batch_no: b.batch_no }))}
                    className={`text-xs px-2.5 py-1 rounded-lg border ${f.product_code === b.product_code && f.batch_no === b.batch_no ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-amber-300 text-gray-700'}`}>
                    {b.product_name || b.product_code} · {b.batch_no}{b.missing_packs?.length ? ` · เหลือ ${b.missing_packs.map(label).join(', ')} g` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-xs text-gray-600">วันที่ตรวจ<input type="date" max={bkkToday()} value={date} onChange={(e) => setDate(e.target.value || bkkToday())} className={input} /></label>
          <label className="text-xs text-gray-600 col-span-2">ผลิตภัณฑ์ *<select value={f.product_code} onChange={(e) => set('product_code', e.target.value)} className={input}>
            <option value="">-- เลือกผลิตภัณฑ์ --</option>{PRODUCTS.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}</select></label>
          <label className="text-xs text-gray-600">เลขล็อต / Batch *<input list="fg-batches" value={f.batch_no} onChange={(e) => set('batch_no', e.target.value)} className={input} /></label>
          <datalist id="fg-batches">{batches.map((b) => <option key={b} value={b} />)}</datalist>
        </div>

        <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-2.5">
          <div className="text-xs font-semibold text-emerald-900 mb-1.5">1. เลือกขนาดบรรจุ * (หักน้ำหนักกระปุกให้อัตโนมัติ)</div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => {
              const done = plan.checked.includes(s.pack_key)
              return (
                <button key={s.pack_key} type="button" disabled={done} onClick={() => setF((x) => ({ ...x, pack_key: s.pack_key, packs: [...new Set([...x.packs, s.pack_key])] }))}
                  className={`text-left text-sm px-3 py-2 rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed ${f.pack_key === s.pack_key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-gray-300 text-gray-700'}`}>
                  <div className="font-semibold">น้ำหนักสุทธิบนฉลาก {s.label_net_g} g</div>
                  <div className="text-[11px] opacity-80">{done ? 'ตรวจแล้ว ✓' : `หักกระปุก ${s.tare_g} g`}</div>
                </button>
              )
            })}
          </div>
          {f.product_code && f.batch_no.trim() && (
            <div className="mt-2 text-xs text-emerald-900">
              Batch นี้บรรจุขนาด:{' '}
              {sizes.map((s) => {
                const on = f.packs.includes(s.pack_key) || plan.packs.includes(s.pack_key) || f.pack_key === s.pack_key
                const locked = plan.packs.includes(s.pack_key) || f.pack_key === s.pack_key
                return (
                  <label key={s.pack_key} className="inline-flex items-center gap-1 mr-3">
                    <input type="checkbox" checked={on} disabled={locked} onChange={(e) => setF((x) => ({ ...x, packs: e.target.checked ? [...x.packs, s.pack_key] : x.packs.filter((k) => k !== s.pack_key) }))} />{s.label_net_g} g
                  </label>
                )
              })}
              <span className="block text-[11px] text-emerald-700">ติ๊กทุกขนาดที่ Batch นี้บรรจุ ระบบจะแจ้งเตือนจนกว่าจะตรวจครบทุกขนาด</span>
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">2. น้ำหนักรวม (กระปุก + สติ๊กเกอร์ + น้ำพริก) g *</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {f.gross.map((g, i) => {
              const n = nets[i]
              return (
                <label key={i} className="text-xs text-gray-600">ตัวที่ {i + 1}
                  <input type="number" inputMode="decimal" step="0.1" min="0" disabled={!pk} value={g} placeholder={pk ? 'g' : 'เลือกขนาดก่อน'}
                    onChange={(e) => set('gross', f.gross.map((x, j) => (j === i ? e.target.value : x)))} className={input} />
                  {n !== null && <span className={`block mt-0.5 font-semibold ${n < pk.label_net_g ? 'text-red-700' : 'text-green-700'}`}>สุทธิ {n} g{n < pk.label_net_g ? ' — ต่ำกว่าฉลาก ชั่งซ้ำ' : ''}</span>}
                  {short[i] && (
                    <span className="block mt-1 rounded-lg bg-amber-50 border border-amber-300 p-1.5">
                      <span className="text-amber-900 font-semibold">ชั่งซ้ำ (g) *</span>
                      <input type="number" inputMode="decimal" step="0.1" min="0" value={f.recheck[i] ?? ''} onChange={(e) => set('recheck', Object.assign([...f.recheck], { [i]: e.target.value }))} className={input} />
                      {reNets[i] !== null && <span className={`block mt-0.5 font-semibold ${reNets[i] < pk.label_net_g ? 'text-red-700' : 'text-green-700'}`}>สุทธิ {reNets[i]} g {reNets[i] < pk.label_net_g ? 'ไม่ผ่าน' : 'ผ่าน'}</span>}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
          {pk && f.gross.length < 10 && <button type="button" onClick={() => set('gross', [...f.gross, ''])} className="text-xs text-emerald-700 font-semibold mt-1">+ ชั่งเพิ่มอีกกระปุก</button>}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">3. คุณภาพผลิตภัณฑ์ *</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {FG_SENSORY.map(([k, l]) => (
              <div key={k} className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5"><span className="text-sm text-gray-700">{l}</span><PassFail value={f.sensory[k]} onChange={(v) => set('sensory', { ...f.sensory, [k]: v })} /></div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <label className="text-xs text-gray-600">aw<input type="number" step="0.001" min="0" max="1" value={f.aw} onChange={(e) => set('aw', e.target.value)} placeholder="ไม่วัด" className={input} /></label>
            <label className="text-xs text-gray-600">อุณหภูมิขณะวัด aw (°C)<input type="number" step="0.1" value={f.aw_temp} onChange={(e) => set('aw_temp', e.target.value)} placeholder="ไม่วัด" className={input} /></label>
            <label className="text-xs text-gray-600">pH<input type="number" step="0.01" min="0" max="14" value={f.ph} onChange={(e) => set('ph', e.target.value)} placeholder="ไม่วัด" className={input} /></label>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">4. บรรจุภัณฑ์ / ความปลอดภัย *</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {FG_PACK.map(([k, l]) => (
              <div key={k} className="flex items-center justify-between gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5"><span className="text-sm text-gray-700">{l}</span><PassFail value={f.pack[k]} onChange={(v) => set('pack', { ...f.pack, [k]: v })} /></div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="text-xs text-gray-600">สถานที่จัดเก็บ<select value={f.store_area} onChange={(e) => set('store_area', e.target.value)} className={input}><option value="">อุณหภูมิห้อง</option><option value="CHILL">Chill (ห้องเย็น)</option></select></label>
            <label className="text-xs text-gray-600">อุณหภูมิสถานที่จัดเก็บ (°C)<input type="number" step="0.1" value={f.store_temp} onChange={(e) => set('store_temp', e.target.value)} className={input} /></label>
          </div>
        </div>

        {failsNow.length > 0 && <div className="text-xs bg-red-50 border border-red-200 text-red-800 rounded-lg p-2.5">จะไม่ผ่านเมื่อบันทึก: {failsNow.join(' · ')} — กักสินค้าและแจ้งหัวหน้างาน/QA แล้วระบุสิ่งที่ทำ</div>}
        <label className="text-xs text-gray-600 block">หมายเหตุ{failsNow.length ? ' / สิ่งที่ทำ *' : ''}<textarea rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} className={input} /></label>
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
        {canWrite(user) ? (
          <button onClick={save} disabled={saving || !complete} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-40">
            <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        ) : <div className="text-sm text-gray-500">บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้</div>}
        <div className="text-xs text-gray-500">ผู้บันทึก: <b>{user?.display_name}</b></div>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">บันทึกวันที่ {date}</h2>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {rows.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มี</div>}
        {rows.map((r) => (
          <div key={r.fc_id} className="p-3 text-sm flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-gray-800">{r.product_name || r.product_code} · {r.batch_no}</div>
              <div className="text-[11px] text-gray-500">{r.fc_id} · {r.label_net_g} g (หัก {r.tare_g} g) · สุทธิ {r.net.map((n, i) => (r.recheck?.[i] ? `${n} (ชั่งซ้ำ ${r.recheck[i].net})` : n)).join(' / ')} g{r.aw != null ? ` · aw ${r.aw}` : ''}{r.ph != null ? ` · pH ${r.ph}` : ''} · {r.inspector}</div>
              {r.failed.length > 0 && <div className="text-[11px] text-red-700">{r.failed.join(' · ')}</div>}
            </div>
            <ResultBadge result={r.result} />
            {user?.role === 'QA_MANAGER' && <button onClick={() => voidRow(r)} className="text-[11px] text-gray-500 border border-gray-300 rounded-lg px-2 py-1 hover:text-red-700">ยกเลิก</button>}
          </div>
        ))}
      </div>
    </Layout>
  )
}
