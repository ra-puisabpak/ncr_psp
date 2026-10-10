import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ShieldCheck, ClipboardCheck, AlertTriangle, FileText, RefreshCw, PackageCheck, ListChecks, History, ChevronRight, Boxes, Route, HandHeart, Droplets, Thermometer, Scale, Flame, BookOpen, PackageSearch,
} from 'lucide-react'
import Layout from '../components/Layout'
import { qaApi } from '../api/d1Api'
import { RECEIVING_URL, FORMS } from '../config'
import { useAuth, isQA } from '../auth'
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

const PROG_CLS = { ok: 'bg-green-100 text-green-700', part: 'bg-amber-100 text-amber-800', none: 'bg-red-100 text-red-700', info: 'bg-sky-100 text-sky-800', idle: 'bg-gray-100 text-gray-500' }
const STAGE_SHORT = { BEFORE: 'ก่อน', DURING: 'ระหว่าง', AFTER: 'หลัง' }
const names = (l) => (l.length > 3 ? `${l.slice(0, 3).join(', ')} +${l.length - 3}` : l.join(', '))

// One line under a form card: what has been recorded, and who/what is still missing.
function Prog({ k, prog }) {
  if (!prog) return null
  const d = prog[k]
  let cls, text, miss = ''
  if (k === 'receiving') { cls = d.done ? 'info' : 'idle'; text = d.done ? `${d.done} ใบ · ${d.items} รายการ` : 'ยังไม่มีบันทึก' }
  else if (k === 'weigh') { cls = d.done ? 'info' : 'idle'; text = d.done ? `${d.done} Batch` : 'ยังไม่มีบันทึก' }
  else if (k === 'oil') {
    const have = new Set(d.stages)
    cls = have.size >= 3 ? 'ok' : have.size ? 'part' : 'idle'
    text = `${d.done} ครั้ง · ${['BEFORE', 'DURING', 'AFTER'].map((x) => `${STAGE_SHORT[x]} ${have.has(x) ? '✓' : '–'}`).join(' ')}`
  } else {
    cls = d.expected === 0 ? (d.done ? 'info' : 'idle') : d.done >= d.expected ? 'ok' : d.done ? 'part' : 'none'
    text = d.expected ? `${d.done}/${d.expected}${k === 'cold' ? ' ช่อง' : k === 'hygiene' ? ' คน' : ' Batch'}` : d.done ? `${d.done} รายการ` : 'ยังไม่มีบันทึก'
    if (d.missing?.length) miss = `ขาด: ${names(d.missing)}`
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <Badge cls={`${PROG_CLS[cls]} whitespace-normal max-w-full`}>{k === 'fgcheck' ? (d.produced_on ? `FG ผลิต ${d.produced_on.slice(8)}/${d.produced_on.slice(5, 7)}` : 'FG ผลิตล่าสุด') : prog.date === bkkToday() ? 'วันนี้' : prog.date.slice(5)} {text}</Badge>
      {miss && <span className="text-[10.5px] text-red-700 truncate max-w-full">{miss}</span>}
    </div>
  )
}

// Shortcuts to the QA tools and registers: icon and name only.
const TOOL_CARDS = [
  { to: '/qa/release', title: 'FG Release', icon: Boxes, tone: 'bg-teal-600 text-white', managerOnly: true },
  { to: '/qa/trace', title: 'สอบย้อนกลับ', icon: Route, tone: 'bg-teal-50 text-teal-700' },
  { to: '/qa/materials', title: 'ทะเบียนวัตถุดิบกลาง', icon: BookOpen, tone: 'bg-teal-50 text-teal-700' },
  { to: '/qa/suppliers', title: 'ทะเบียน Supplier กลาง', icon: BookOpen, tone: 'bg-teal-50 text-teal-700' },
  { to: '/qa/spec', title: 'ข้อกำหนดตรวจรับ', icon: ListChecks, tone: 'bg-teal-50 text-teal-700' },
]

// The daily forms in form-number order. The card shows what the form is, today's progress and a report button.
const FORM_CARDS = [
  { form: 'RECEIVING', title: 'ตรวจรับวัตถุดิบ', prog: 'receiving', icon: PackageCheck, tone: 'bg-orange-50 text-orange-600', external: true, to: RECEIVING_URL, report: (d) => `${RECEIVING_URL}?report=${d}` },
  { form: 'PRODCTL', title: 'แบบฟอร์มควบคุมการผลิต', prog: 'prodctl', icon: Flame, tone: 'bg-orange-50 text-orange-600', to: '/qa/prodctl', report: (d) => `/qa/prodctl/report?date=${d}` },
  { form: 'WEIGH', title: 'บันทึกการชั่งวัตถุดิบ', prog: 'weigh', icon: Scale, tone: 'bg-violet-50 text-violet-600', to: '/qa/weigh', report: (d) => `/qa/weigh/day?date=${d}` },
  { form: 'OIL', title: 'คุณภาพน้ำมันทอด', prog: 'oil', icon: Droplets, tone: 'bg-amber-50 text-amber-600', to: '/qa/oil', report: (d) => `/qa/oil/report?month=${d.slice(0, 7)}` },
  { form: 'COLD', title: 'อุณหภูมิตู้เย็น / ตู้แช่แข็ง', prog: 'cold', icon: Thermometer, tone: 'bg-sky-50 text-sky-600', to: '/qa/cold', report: (d) => `/qa/cold/report?month=${d.slice(0, 7)}` },
  { form: 'FG_CHECK', title: 'ตรวจสอบผลิตภัณฑ์สุดท้าย', prog: 'fgcheck', icon: PackageSearch, tone: 'bg-emerald-50 text-emerald-600', to: '/qa/fgcheck', report: (d) => `/qa/fgcheck/report?date=${d}` },
  { form: 'HYGIENE', title: 'สุขลักษณะส่วนบุคคล', prog: 'hygiene', icon: HandHeart, tone: 'bg-blue-50 text-blue-700', to: '/qa/hygiene', report: (d) => `/qa/hygiene/report?date=${d}` },
]

export default function QADashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [date, setDate] = useState(bkkToday())
  const [summary, setSummary] = useState(null)
  const [points, setPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCp, setShowCp] = useState(false)
  const [prog, setProg] = useState(null) // how much each form has recorded today (QA Manager only)
  const [error, setError] = useState(null)
  const [coldAlerts, setColdAlerts] = useState(null) // cold-storage alerts (QA Manager / FSTL)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [s, cps] = await Promise.all([qaApi.summary(date), qaApi.controlPoints()])
      setSummary(s); setPoints(cps)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [date]) // eslint-disable-line react-hooks/exhaustive-deps
  // Live count of what each form has recorded on the chosen day: every 30 s, and when the tab comes back to the front.
  useEffect(() => {
    if (user?.role !== 'QA_MANAGER') return undefined
    let stop = false
    const pull = () => qaApi.dailyProgress(date).then((p) => { if (!stop) setProg(p) }).catch(() => {})
    pull()
    const t = setInterval(pull, 30000)
    const vis = () => { if (document.visibilityState === 'visible') pull() }
    document.addEventListener('visibilitychange', vis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [date, user?.role])

  useEffect(() => {
    if (!isQA(user)) return undefined
    let stop = false
    const pull = () => qaApi.coldAlerts(date).then((a) => { if (!stop) setColdAlerts(a) }).catch(() => {})
    pull()
    const t = setInterval(pull, 30000)
    return () => { stop = true; clearInterval(t) }
  }, [date, user?.role]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = points.filter((c) => c.status !== 'RETIRED')
  const approved = active.filter((c) => c.status === 'APPROVED').length
  const byCp = Object.fromEntries((summary?.byCp || []).map((r) => [r.cp_id, r]))
  const cpToday = (summary?.byCp || []).reduce((t, r) => ({ total: t.total + (r.total || 0), fail: t.fail + (r.fail || 0) }), { total: 0, fail: 0 })
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

      {coldAlerts?.alerts?.length > 0 && (
        <Link to="/qa/cold" className="block bg-white rounded-xl shadow border-l-4 border-red-500 p-3 mb-4 hover:shadow-md transition">
          <div className="text-sm font-bold text-gray-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-600" />แจ้งเตือนตู้เย็น / ตู้แช่แข็ง ({coldAlerts.alerts.length})</div>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {coldAlerts.alerts.slice(0, 6).map((a, i) => <li key={i} className={a.level === 'red' ? 'text-red-700' : 'text-amber-800'}><b>{a.unit_id}</b> · {a.text}</li>)}
            {coldAlerts.alerts.length > 6 && <li className="text-gray-500">และอีก {coldAlerts.alerts.length - 6} รายการ</li>}
          </ul>
        </Link>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile icon={ClipboardCheck} label="บันทึกตรวจ" sub={date === bkkToday() ? 'วันนี้' : date} value={summary?.total ?? '–'} tone="teal" to="/qa/records" />
        <Tile icon={AlertTriangle} label="ไม่ผ่านเกณฑ์" sub={user?.auto_ncr ? 'เปิด NCR อัตโนมัติ' : 'ช่วงทดลอง ยังไม่เปิด NCR'} value={summary?.fail ?? '–'} tone={summary?.fail ? 'red' : 'green'} to="/qa/records?result=FAIL" />
        <Tile icon={FileText} label="NCR ค้างอยู่" sub={`จากการผลิต ${summary?.ncrProcessOpen ?? 0} รายการ`} value={summary?.ncrOpen ?? '–'} tone={summary?.ncrOpen ? 'orange' : 'green'} to="/ncr" />
        {user?.role === 'QA_MANAGER' && <Tile icon={ListChecks} label="จุดควบคุมที่อนุมัติแล้ว" sub="ที่เหลือรอ validate" value={`${approved}/${active.length}`} tone={approved === active.length && active.length ? 'green' : 'orange'} to="/qa/control-points" />}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {TOOL_CARDS.filter((c) => !c.managerOnly || user?.role === 'QA_MANAGER').map((c) => {
          const Icon = c.icon
          return (
            <Link key={c.to} to={c.to} className="bg-white rounded-xl shadow p-3 flex items-center gap-3 hover:shadow-md transition">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${c.tone}`}><Icon className="w-6 h-6" /></div>
              <div className="font-semibold text-sm text-gray-800 leading-snug min-w-0">{c.title}</div>
            </Link>
          )
        })}
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-gray-700">บันทึกตรวจ</h2>
        {prog && <span className="text-[11px] text-gray-500 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />สด · ข้อมูล{date === bkkToday() ? 'วันนี้' : ` ${date}`} · อัปเดต {prog.at}</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {FORM_CARDS.map((c) => {
          const Icon = c.icon
          const report = typeof c.report === 'function' ? c.report(date) : c.report
          const inner = (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${c.tone}`}><Icon className="w-6 h-6" /></div>
                <span className="font-mono text-[10.5px] text-gray-400">{FORMS[c.form].code}</span>
              </div>
              <div className="font-semibold text-sm text-gray-800 leading-snug">{c.title}</div>
              {user?.role === 'QA_MANAGER' && <Prog k={c.prog} prog={prog} />}
            </>
          )
          const cls = 'block bg-white rounded-xl shadow p-3 pb-10 hover:shadow-md transition'
          const rcls = 'absolute right-3 bottom-2 text-[11px] font-semibold text-blue-700 border border-blue-200 bg-blue-50 rounded-lg px-2 py-0.5 flex items-center gap-1'
          return (
            <div key={c.form} className="relative">
              {c.external ? <a href={c.to} className={cls}>{inner}</a> : <Link to={c.to} className={cls}>{inner}</Link>}
              {c.external ? <a href={report} className={rcls}><FileText className="w-3 h-3" />รายงาน</a> : <Link to={report} className={rcls}><FileText className="w-3 h-3" />รายงาน</Link>}
            </div>
          )
        })}
      </div>

      {active.length > 0 && (
        <div className="mb-6">
          <button type="button" onClick={() => setShowCp((v) => !v)} className="w-full flex items-center gap-2 text-left bg-white rounded-xl shadow px-4 py-3">
            <ListChecks className="w-5 h-5 text-teal-700 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-gray-800">บันทึกจุดควบคุมโดยตรง (CCP / OPRP / PRP)</div>
              <div className="text-[11px] text-gray-500">{active.length} จุด · CCP-01 / CCP-02 / OPRP-05 ระบบบันทึกให้จากแบบฟอร์มควบคุมการผลิตอยู่แล้ว</div>
            </div>
            {cpToday.fail > 0 && <Badge cls="bg-red-100 text-red-700">ไม่ผ่าน {cpToday.fail}</Badge>}
            {cpToday.total > 0 && <Badge cls="bg-slate-100 text-slate-600">วันนี้ {cpToday.total}</Badge>}
            <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${showCp ? 'rotate-90' : ''}`} />
          </button>
          {showCp && (
            <div className="bg-white rounded-xl shadow mt-2 divide-y divide-gray-100">
              {active.map((c) => {
                const today = byCp[c.cp_id]
                return (
                  <button key={c.cp_id} onClick={() => navigate(`/qa/record/${c.cp_id}`)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                    <span className="font-mono text-[11px] text-gray-400 w-16 shrink-0">{c.cp_id}</span>
                    <span className="min-w-0 flex-1 text-sm text-gray-800 truncate">{c.name}</span>
                    <Badge cls={CP_TYPE_CLS[c.cp_type]}>{CP_TYPE_TH[c.cp_type]}</Badge>
                    {today && <Badge cls={today.fail ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}>{today.total}{today.fail ? ` · ไม่ผ่าน ${today.fail}` : ''}</Badge>}
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </button>
                )
              })}
              <div className="px-3 py-2 text-[11px] text-gray-500">สถานะ "รอ validate" ของทุกจุดดูและกำหนดเกณฑ์ที่ทะเบียนจุดควบคุม (QA Manager)</div>
            </div>
          )}
        </div>
      )}

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
