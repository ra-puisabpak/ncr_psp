import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, X } from 'lucide-react'
import Layout from '../components/Layout'
import { specApi } from '../api/d1Api'
import { useAuth, isQA } from '../auth'
import { Badge } from '../qa/shared'

const LV = { Critical: 'bg-red-100 text-red-800', Major: 'bg-orange-100 text-orange-800', Minor: 'bg-gray-100 text-gray-700' }
const input = 'w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'

// The receiving specification (RD-RMS raw materials, RD-PMS packaging): what each lot is checked against.
// A failed Critical item rejects the lot; a failed Major / Minor item holds it. QA edits the items here.
export default function SpecPage() {
  const { user } = useAuth()
  const qa = isQA(user)
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [edit, setEdit] = useState(null)
  const [error, setError] = useState(null)
  const load = () => specApi.list().then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const save = async () => {
    setError(null)
    try { await specApi.update(edit.group, edit.seq, { title: edit.title, criterion: edit.criterion, method: edit.method, level: edit.level }); setEdit(null); await load() } catch (e) { setError(e.message) }
  }
  const toggle = async (g, i) => { try { await specApi.update(g.key, i.seq, { active: !i.active }); await load() } catch (e) { setError(e.message) } }
  const matsOf = (key) => Object.entries(data?.mats || {}).filter(([, k]) => k === key).map(([c]) => c)

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <h1 className="text-lg font-bold text-gray-800">ข้อกำหนดตรวจรับ</h1>
      <div className="text-xs text-gray-500 mb-3">ใช้เป็นรายการตรวจในแอปรับวัตถุดิบ · Critical ไม่ผ่าน = REJECT · Major / Minor ไม่ผ่าน = HOLD · ค่าที่ไม่ได้อนุมัติ (ฉบับร่าง Rev.00) แก้ได้ที่นี่ และการแก้ไขถูกบันทึกประวัติ · ปิดใช้งานแทนการลบ</div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-3">{error}</div>}
      <div className="space-y-2">
        {(data?.groups || []).map((g) => (
          <div key={g.key} className="bg-white rounded-xl shadow">
            <button onClick={() => setOpen(open === g.key ? null : g.key)} className="w-full text-left p-3 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-gray-800">{g.key} · {g.name}</div>
                <div className="text-[11px] text-gray-500">{g.items.filter((i) => i.active).length} รายการตรวจ · {matsOf(g.key).length} รหัส</div>
              </div>
              <span className="text-gray-400 text-xs">{open === g.key ? 'ย่อ' : 'ดู'}</span>
            </button>
            {open === g.key && (
              <div className="border-t border-gray-100 divide-y divide-gray-100">
                <div className="p-3 text-[11px] text-gray-500">รหัส: {matsOf(g.key).join(', ')}{g.sample_plan ? <><br />แผนสุ่ม: {g.sample_plan}</> : null}</div>
                {g.items.map((i) => (
                  <div key={i.seq} className={`p-3 ${i.active ? '' : 'opacity-50'}`}>
                    {edit && edit.group === g.key && edit.seq === i.seq ? (
                      <div className="space-y-2">
                        <label className="text-xs text-gray-600 block">หัวข้อ<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={input} /></label>
                        <label className="text-xs text-gray-600 block">เกณฑ์ยอมรับ<textarea rows={2} value={edit.criterion} onChange={(e) => setEdit({ ...edit, criterion: e.target.value })} className={input} /></label>
                        <label className="text-xs text-gray-600 block">วิธีตรวจ<input value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })} className={input} /></label>
                        <label className="text-xs text-gray-600 block">ระดับ<select value={edit.level} onChange={(e) => setEdit({ ...edit, level: e.target.value })} className={input}>{Object.keys(LV).map((k) => <option key={k}>{k}</option>)}</select></label>
                        <div className="flex gap-2">
                          <button onClick={save} className="flex items-center gap-1 bg-teal-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"><Save className="w-4 h-4" />บันทึก</button>
                          <button onClick={() => setEdit(null)} className="flex items-center gap-1 bg-gray-100 text-sm px-3 py-1.5 rounded-lg"><X className="w-4 h-4" />ยกเลิก</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-gray-800">{i.seq}. {i.title} <Badge cls={LV[i.level]}>{i.level}</Badge></div>
                          <div className="text-xs text-gray-600">เกณฑ์: {i.criterion || '-'}</div>
                          {i.method && <div className="text-[11px] text-gray-400">วิธีตรวจ: {i.method}</div>}
                        </div>
                        {qa && (
                          <div className="flex flex-col gap-1">
                            <button onClick={() => setEdit({ group: g.key, seq: i.seq, title: i.title, criterion: i.criterion || '', method: i.method || '', level: i.level })} className="text-xs border border-gray-300 rounded-lg px-2 py-1">แก้ไข</button>
                            <button onClick={() => toggle(g, i)} className="text-xs border border-gray-300 rounded-lg px-2 py-1 whitespace-nowrap">{i.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Layout>
  )
}
