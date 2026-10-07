import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Save, X, History, Search } from 'lucide-react'
import Layout from '../components/Layout'
import AuditTrail from '../components/AuditTrail'
import { materialApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { Badge } from '../qa/shared'
import { TYPE_GROUP, refreshMaterials } from '../data/materials'

const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
const CROP_TH = { shallot: 'หอม', garlic: 'กระเทียม', chili: 'พริก' }
const PREFIX = { RM: 'RM', PM: 'PKG', CM: 'SUP' }
const blank = { code: '', name: '', type: 'RM', unit: '', cat: '', min_temp: '', max_temp: '', temp_label: '', store: '', aql_crop: '', ph_min: '', ph_max: '' }
const tempText = (m) => (m.temp_label ? m.temp_label : m.min_temp != null ? `${m.min_temp}–${m.max_temp} °C` : '')

// The next free code for a type, e.g. RM-053.
const nextCode = (list, type) => {
  const p = PREFIX[type]
  const n = Math.max(0, ...list.filter((m) => m.code.startsWith(p + '-')).map((m) => parseInt(m.code.split('-')[1], 10) || 0)) + 1
  return `${p}-${String(n).padStart(3, '0')}`
}

function Editor({ value, isNew, list, onCancel, onSaved }) {
  const [m, setM] = useState(() => Object.fromEntries(Object.keys(blank).map((k) => [k, value[k] ?? ''])))
  const [error, setError] = useState(null)
  const set = (k) => (e) => setM((x) => ({ ...x, [k]: e.target.value }))
  const setType = (e) => setM((x) => ({ ...x, type: e.target.value, code: isNew ? nextCode(list, e.target.value) : x.code, aql_crop: e.target.value === 'RM' ? x.aql_crop : '' }))
  const save = async () => {
    setError(null)
    const body = { ...m }
    try {
      if (isNew) await materialApi.create(body)
      else { delete body.code; await materialApi.update(m.code, body) }
      onSaved()
    } catch (e) { setError(e.message) }
  }
  return (
    <div className="p-3 bg-teal-50 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="text-xs text-gray-600">ประเภท<select value={m.type} onChange={setType} className={input}>{Object.entries(TYPE_GROUP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs text-gray-600">รหัส *<input value={m.code} disabled={!isNew} onChange={(e) => setM((x) => ({ ...x, code: e.target.value.toUpperCase() }))} className={`${input} font-mono`} /></label>
        <label className="text-xs text-gray-600 col-span-2">ชื่อ *<input value={m.name} onChange={set('name')} className={input} /></label>
        <label className="text-xs text-gray-600">หน่วย<input value={m.unit} onChange={set('unit')} placeholder="เช่น กิโลกรัม" className={input} /></label>
        <label className="text-xs text-gray-600">กลุ่ม<input value={m.cat} onChange={set('cat')} placeholder="เช่น Seasoning" className={input} /></label>
        <label className="text-xs text-gray-600">อุณหภูมิรับต่ำสุด (°C)<input type="number" step="0.1" value={m.min_temp} onChange={set('min_temp')} placeholder="ไม่กำหนด" className={input} /></label>
        <label className="text-xs text-gray-600">อุณหภูมิรับสูงสุด (°C)<input type="number" step="0.1" value={m.max_temp} onChange={set('max_temp')} placeholder="ไม่กำหนด" className={input} /></label>
        <label className="text-xs text-gray-600 col-span-2 sm:col-span-3">วิธีจัดเก็บ<input value={m.store} onChange={set('store')} placeholder="เช่น แช่เย็น 1-4°C ปิดฝาสนิท" className={input} /></label>
        <label className="text-xs text-gray-600">ข้อความเกณฑ์อุณหภูมิ<input value={m.temp_label} onChange={set('temp_label')} placeholder="เช่น ≤ -18°C" className={input} /></label>
        {m.type === 'RM' && (
          <>
            <label className="text-xs text-gray-600">แผนสุ่ม OPL (AQL)<select value={m.aql_crop} onChange={set('aql_crop')} className={input}><option value="">ไม่ใช้</option>{Object.entries(CROP_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="text-xs text-gray-600">pH ต่ำสุด (ตอนรับ)<input type="number" step="0.01" value={m.ph_min} onChange={set('ph_min')} placeholder="ไม่ตรวจ" className={input} /></label>
            <label className="text-xs text-gray-600">pH สูงสุด (ตอนรับ)<input type="number" step="0.01" value={m.ph_max} onChange={set('ph_max')} placeholder="ไม่ตรวจ" className={input} /></label>
          </>
        )}
      </div>
      <div className="text-[11px] text-gray-500">อุณหภูมิ: เว้นว่างทั้งคู่ถ้าไม่ตรวจอุณหภูมิตอนรับ · แผนสุ่ม OPL ใช้กับหอม กระเทียม พริกที่แปรรูปเบื้องต้น · pH: ใส่ทั้งสองค่าเมื่อต้องวัด pH ตัวอย่าง OPL ตอนรับ (นอกช่วง = HOLD) เว้นว่าง = ไม่วัด · หมูบดใช้แผน IQC ของตัวเอง</div>
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} className="flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Save className="w-4 h-4" />บันทึก</button>
        <button onClick={onCancel} className="flex items-center gap-1 bg-gray-100 text-sm px-3 py-1.5 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
      </div>
    </div>
  )
}

export default function MaterialsPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [list, setList] = useState([])
  const [type, setType] = useState('RM')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { materialApi.list().then(setList).catch((e) => setError(e.message)) }, [refresh])
  const done = () => { setEditing(null); setRefresh((n) => n + 1); refreshMaterials() }
  const toggle = async (m) => { try { await materialApi.update(m.code, { active: !m.active }); done() } catch (e) { setError(e.message) } }
  const shown = list.filter((m) => m.type === type && (!q.trim() || `${m.code} ${m.name} ${m.cat || ''}`.toLowerCase().includes(q.trim().toLowerCase())))

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800">ทะเบียนวัตถุดิบกลาง</h1>
          <div className="text-xs text-gray-500">ใช้ร่วมกันทั้งตรวจรับ (FM-QC-001) บันทึกการชั่ง สอบย้อนกลับ และ NCR · แก้ไขได้เฉพาะ QA Manager / FSTL · ไม่มีการลบ ใช้ "ปิดใช้งาน" แทน</div>
        </div>
        {qa && !editing && <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Plus className="w-4 h-4" />เพิ่มรายการ</button>}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        {Object.entries(TYPE_GROUP).map(([k, v]) => (
          <button key={k} onClick={() => setType(k)} className={`text-sm px-3 py-1.5 rounded-lg border ${type === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-gray-300 text-gray-700'}`}>{v} ({list.filter((m) => m.type === k).length})</button>
        ))}
        <div className="relative flex-1 min-w-[160px]"><Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นรหัส ชื่อ หรือกลุ่ม" className={`${input} pl-8`} /></div>
      </div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {editing === 'new' && <Editor value={{ ...blank, type, code: nextCode(list, type) }} isNew list={list} onCancel={() => setEditing(null)} onSaved={done} />}
        {shown.length === 0 && editing !== 'new' && <div className="p-4 text-sm text-gray-400 text-center">ไม่พบรายการ</div>}
        {shown.map((m) => (editing === m.code ? <Editor key={m.code} value={m} list={list} onCancel={() => setEditing(null)} onSaved={done} /> : (
          <div key={m.code} className={`p-3 ${m.active ? '' : 'opacity-50'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-500">{m.code}</span>
                  <span className="font-semibold text-gray-800">{m.name}</span>
                  {m.cat && <Badge cls="bg-gray-100 text-gray-600">{m.cat}</Badge>}
                  {tempText(m) && <Badge cls="bg-sky-100 text-sky-800">รับ {tempText(m)}</Badge>}
                  {m.aql_crop && <Badge cls="bg-violet-100 text-violet-800">OPL {CROP_TH[m.aql_crop]}</Badge>}
                  {m.ph_min != null && <Badge cls="bg-amber-100 text-amber-800">pH {m.ph_min}–{m.ph_max}</Badge>}
                  {!m.active && <Badge cls="bg-gray-200 text-gray-500">ปิดใช้งาน</Badge>}
                </div>
                <div className="text-[11px] text-gray-500">{[m.unit, m.store].filter(Boolean).join(' · ') || '-'}</div>
              </div>
              {qa && !editing && <button onClick={() => setEditing(m.code)} className="p-1 text-gray-400 hover:text-teal-700"><Pencil className="w-4 h-4" /></button>}
              {qa && <button onClick={() => setHistory(history === m.code ? null : m.code)} className="p-1 text-gray-400 hover:text-blue-700"><History className="w-4 h-4" /></button>}
              {qa && <button onClick={() => toggle(m)} className="text-xs border border-gray-300 rounded-lg px-2 py-1 whitespace-nowrap">{m.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}
            </div>
            {history === m.code && <AuditTrail entityId={m.code} refreshKey={refresh} />}
          </div>
        )))}
      </div>
    </Layout>
  )
}
