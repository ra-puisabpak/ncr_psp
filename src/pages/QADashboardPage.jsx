import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ClipboardCheck, AlertTriangle, FileText, RefreshCw, PackageCheck, ListChecks, History, ChevronRight, Boxes, Route, HandHeart, Droplets, Thermometer, Scale,
} from 'lucide-react'
import Layout from '../components/Layout'
import { qaApi } from '../api/d1Api'
import { RECEIVING_URL } from '../config'
import { CP_TYPE_TH, CP_TYPE_CLS, CP_STATUS_TH, CP_STATUS_CLS, Badge, ResultBadge, bkkToday } from '../qa/shared'

function Tile({ icon: Icon, label, value, sub, tone, to }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-800 border-teal-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    green: 'bg-green-50 text-green-700 border-green-100',
  }
  const body = (
    <>
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 opacity-70" />
        <span className="text-2xl font-bold tabular-nums">{value}</span>
      </div>
      <div className="text-xs font-semibold mt-1">{label}</div>
      {sub && <div className="text-[11px] opacity-70">{sub}</div>}
    </>
  )
  const cls = `border rounded-xl p-4 block ${tones[tone]}`
  return to ? <Link to={to} className={`${cls} hover:shadow-md transition`}>{body}</Link> : <div className={cls}>{body}</div>
}

export default function QADashboardPage() {
  const navigate = useNavigate()
  const [date, setDate] = useState(bkkToday())
  const [summary, setSummary] = useState(null)
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [s, cps] = await Promise.all([qaApi.summary(date), qaApi.controlPoints()])
      setSummary(s); setPoints(cps)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = points.filter((c) => c.status !== 'RETIRED')
  const approved = active.filter((c) => c.status === 'APPROVED').length
  const byCp = Object.fromEntries((summary?.byCp || []).map((r) => [r.cp_id, r]))
  const cpName = Object.fromEntries(points.map((c) => [c.cp_id, c.name]))

  const pageActions = (
    <button onClick={load} title="รีเฟรช" className="p-2 hover:bg-white/20 rounded-lg transition text-white">
      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  )

  return (
    <Layout pageActions={pageActions}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-teal-600" />PSP QUALITY APP
          </h1>
          <div className="text-xs text-gray-500">บันทึกการเฝ้าระวังจุดควบคุม · GHPs · HACCP · Codex</div>
        </div>
        <label className="text-xs text-gray-600 flex items-center gap-2">
          วันที่
          <input type="date" value={date} max={bkkToday()} onChange={(e) => setDate(e.target.value || bkkToday())}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile icon={ClipboardCheck} label="บันทึกตรวจ" sub={date === bkkToday() ? 'วันนี้' : date} value={summary?.total ?? '–'} tone="teal" to="/qa/records" />
        <Tile icon={AlertTriangle} label="ไม่ผ่านเกณฑ์" sub="เปิด NCR อัตโนมัติ" value={summary?.fail ?? '–'} tone={summary?.fail ? 'red' : 'green'} to="/qa/records?result=FAIL" />
        <Tile icon={FileText} label="NCR ค้างอยู่" sub={`จากการผลิต ${summary?.ncrProcessOpen ?? 0} รายการ`} value={summary?.ncrOpen ?? '–'} tone={summary?.ncrOpen ? 'orange' : 'green'} to="/ncr" />
        <Tile icon={ListChecks} label="จุดควบคุมที่อนุมัติแล้ว" sub="ที่เหลือรอ validate" value={`${approved}/${active.length}`} tone={approved === active.length && active.length ? 'green' : 'orange'} to="/qa/control-points" />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link to="/qa/release" className="bg-teal-600 text-white rounded-xl shadow p-4 flex items-center gap-3 hover:bg-teal-700 transition">
          <Boxes className="w-6 h-6 shrink-0" />
          <div className="min-w-0"><div className="font-semibold text-sm">FG Release</div><div className="text-[11px] opacity-80">ตรวจและตัดสินปล่อย Batch</div></div>
        </Link>
        <Link to="/qa/trace" className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition">
          <Route className="w-6 h-6 shrink-0 text-teal-700" />
          <div className="min-w-0"><div className="font-semibold text-sm text-gray-800">สอบย้อนกลับ</div><div className="text-[11px] text-gray-500">ค้นด้วยล็อตหรือ Batch</div></div>
        </Link>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">บันทึกตรวจ</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <Link to="/qa/weigh" className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition">
          <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><Scale className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-800">บันทึกการชั่งวัตถุดิบ</div>
            <div className="text-[11px] text-gray-500">PD_03 · ตามสูตร พร้อม LOT วัตถุดิบ</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </Link>
        <Link to="/qa/oil" className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition">
          <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><Droplets className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-800">คุณภาพน้ำมันทอด</div>
            <div className="text-[11px] text-gray-500">FM-QC-07 · TPM และอุณหภูมิ</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </Link>
        <Link to="/qa/cold" className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition">
          <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0"><Thermometer className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-800">อุณหภูมิตู้เย็น / ตู้แช่แข็ง</div>
            <div className="text-[11px] text-gray-500">FM-QC-05 · 08:00 · 11:00 · 15:00 · 17:00</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </Link>
        <Link to="/qa/hygiene" className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center shrink-0"><HandHeart className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-800">สุขลักษณะส่วนบุคคล</div>
            <div className="text-[11px] text-gray-500">ตรวจก่อนเข้างาน{summary ? ` · ${date === bkkToday() ? 'วันนี้' : date} ${summary.hygTotal} คน${summary.hygFail ? ` · ไม่ผ่าน ${summary.hygFail}` : ''}` : ''}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </Link>
        <a href={RECEIVING_URL} className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition">
          <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0"><PackageCheck className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-gray-800">ตรวจรับวัตถุดิบ</div>
            <div className="text-[11px] text-gray-500">FM-QC-001 · บันทึกการตรวจรับ</div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </a>
        {active.map((c) => {
          const today = byCp[c.cp_id]
          return (
            <button key={c.cp_id} onClick={() => navigate(`/qa/record/${c.cp_id}`)}
              className="bg-white rounded-xl shadow p-4 flex items-center gap-3 hover:shadow-md transition text-left">
              <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center shrink-0"><ClipboardCheck className="w-5 h-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-gray-800 truncate">{c.name}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  <Badge cls={CP_TYPE_CLS[c.cp_type]}>{CP_TYPE_TH[c.cp_type]}</Badge>
                  <Badge cls={CP_STATUS_CLS[c.status]}>{CP_STATUS_TH[c.status]}</Badge>
                  {today && <Badge cls={today.fail ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}>{today.total} บันทึก{today.fail ? ` · ไม่ผ่าน ${today.fail}` : ''}</Badge>}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-gray-700">บันทึกล่าสุด</h2>
        <Link to="/qa/records" className="text-xs text-blue-700 flex items-center gap-1"><History className="w-3.5 h-3.5" />ดูทั้งหมด</Link>
      </div>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {summary && summary.recent.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มีบันทึก</div>}
        {(summary?.recent || []).map((r) => (
          <div key={r.rec_id} className="p-3 flex items-center gap-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-800 truncate">{cpName[r.cp_id] || r.cp_id} · Batch {r.batch_no}</div>
              <div className="text-[11px] text-gray-500 truncate">
                {r.rec_id} · {r.record_date} {r.record_time || ''} · {r.product_name || '-'} · {r.inspector}
              </div>
            </div>
            {r.ncr_id && <Link to={`/ncr/${r.ncr_id}`} className="text-[11px] font-semibold text-red-700 underline whitespace-nowrap">{r.ncr_id}</Link>}
            <ResultBadge result={r.result} />
          </div>
        ))}
      </div>
    </Layout>
  )
}
