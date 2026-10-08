import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Save, Printer, CheckCircle2, XCircle, AlertTriangle, Droplets } from 'lucide-react'
import Layout from '../components/Layout'
import { oilApi } from '../api/d1Api'
import { useAuth, canWrite, isQA } from '../auth'
import { Badge, bkkToday, bkkTime, monthOf, monthRange, newUid } from '../qa/shared'
import { FORMS } from '../config'

const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500'
export const STAGE_TH = { BEFORE: 'ก่อนการผลิต', DURING: 'ระหว่างการผลิต', AFTER: 'หลังการผลิต' }
export const OIL_RESULT = {
  PASS: { label: 'ปกติ', cls: 'bg-green-100 text-green-700' },
  WATCH: { label: 'เฝ้าระวัง', cls: 'bg-amber-100 text-amber-800' },
  FAIL: { label: 'ห้ามใช้ / ไม่ผ่าน', cls: 'bg-red-100 text-red-700' },
}
export const OIL_TEMP_MIN = 150, OIL_TEMP_MAX = 180
const tpmState = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v) >= 25 ? 'FAIL' : Number(v) >= 20 ? 'WATCH' : 'PASS')

function VerifyBox({ row, onDone }) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState(null)
  const go = async (decision) => { setErr(null); try { await oilApi.verify(row.chk_id, { decision, note }); onDone() } catch (e) { setErr(e.message) } }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุการทวนสอบ (REJECT ต้องระบุ)" className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-2 py-1 text-xs" />
      <button onClick={() => go('APPROVE')} className="text-xs font-semibold bg-green-600 text-white rounded-lg px-2.5 py-1">APPROVE</button>
      <button onClick={() => go('REJECT')} className="text-xs font-semibold bg-red-600 text-white rounded-lg px-2.5 py-1">REJECT</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  )
}

export default function OilPage() {
  const { user } = useAuth()
  const [f, setF] = useState(() => ({ check_date: bkkToday(), check_time: bkkTime(), stage: 'BEFORE', line: '', oil_type: '', tank: '', tpm_meter: '', thermometer: '' }))
  const [tpm, setTpm] = useState(['', '', ''])
  const [temps, setTemps] = useState(['', '', ''])
  const [tempResult, setTempResult] = useState('')
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [uid, setUid] = useState(newUid)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [rows, setRows] = useState([])

  const [reach, setReach] = useState('')
  const month = monthOf(bkkToday())
  const load = () => oilApi.list(monthRange(month)).then(setRows).catch(() => {})
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  // The usable range is a fixed criterion, so the temperature result follows the readings.
  const tempNums = temps.filter((v) => v !== '').map(Number)
  const autoTemp = !tempNums.length ? '' : tempNums.some((t) => t < OIL_TEMP_MIN || t > OIL_TEMP_MAX) ? 'FAIL' : 'PASS'
  useEffect(() => { setTempResult((x) => (x === 'NA' ? x : autoTemp)) }, [autoTemp])
  const tpmVals = tpm.filter((v) => v !== '').map(Number)
  const worst = tpmVals.length ? Math.max(...tpmVals) : null
  const preview = worst === null ? null : worst >= 25 || tempResult === 'FAIL' ? 'FAIL' : worst >= 20 ? 'WATCH' : 'PASS'

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await oilApi.save({ uid, ...f, tpm, temps, temp_result: tempResult, reach_min: reach, action, note })
      setSaved(res); setUid(newUid())
      setTpm(['', '', '']); setTemps(['', '', '']); setTempResult(''); setReach(''); setAction(''); setNote('')
      setF((x) => ({ ...x, check_time: bkkTime(), stage: x.stage === 'BEFORE' ? 'AFTER' : x.stage }))
      load(); window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <Layout>
      <Link to="/qa" className="text-sm text-blue-700 flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" />PSP QUALITY APP</Link>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Droplets className="w-5 h-5 text-amber-600" />คุณภาพน้ำมันทอดและอุณหภูมิ</h1>
          <div className="text-xs text-gray-500">{FORMS.OIL.code} Rev.{FORMS.OIL.rev} · TPM &lt; 20% ปกติ · 20–&lt;25% เฝ้าระวัง · ≥ 25% ห้ามใช้ (ประกาศ สธ.)</div>
        </div>
        <Link to={`/qa/oil/report?month=${month}`} className="flex items-center gap-1.5 text-sm bg-white border border-gray-300 rounded-lg px-3 py-1.5"><Printer className="w-4 h-4" />รายงาน A4</Link>
      </div>

      {saved && (
        <div className={`rounded-xl p-3 mb-4 text-sm font-semibold flex items-center gap-2 ${OIL_RESULT[saved.result].cls}`}>
          {saved.result === 'FAIL' ? <XCircle className="w-5 h-5" /> : saved.result === 'WATCH' ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          <span className="flex-1">บันทึก {saved.chk_id} — {OIL_RESULT[saved.result].label}
          {saved.ncr_id && <> · เปิด <Link to={`/ncr/${saved.ncr_id}`} className="underline whitespace-nowrap">{saved.ncr_id}</Link> และกักกันน้ำมัน</>}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow p-4 space-y-3 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-xs text-gray-600">วันที่<input type="date" max={bkkToday()} value={f.check_date} onChange={set('check_date')} className={input} /></label>
          <label className="text-xs text-gray-600">เวลา<input type="time" value={f.check_time} onChange={set('check_time')} className={input} /></label>
          <label className="text-xs text-gray-600 col-span-2">ช่วงที่ตรวจ
            <div className="grid grid-cols-3 gap-1.5 mt-0.5">
              {Object.entries(STAGE_TH).map(([k, v]) => (
                <button type="button" key={k} onClick={() => setF((x) => ({ ...x, stage: k }))}
                  className={`py-2 rounded-lg text-xs font-semibold border ${f.stage === k ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-600 border-gray-300'}`}>{v}</button>
              ))}
            </div>
          </label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <label className="text-xs text-gray-600 col-span-2 sm:col-span-1">ผลิตภัณฑ์ / ไลน์ผลิต<input value={f.line} onChange={set('line')} placeholder="เช่น พริกผัดน้ำมันมะกอก" className={input} /></label>
          <label className="text-xs text-gray-600">ชนิดน้ำมัน<input value={f.oil_type} onChange={set('oil_type')} placeholder="เช่น น้ำมันรำข้าว" className={input} /></label>
          <label className="text-xs text-gray-600">Lot / Batch / ถัง<input value={f.tank} onChange={set('tank')} className={input} /></label>
          <label className="text-xs text-gray-600">รหัสเครื่องวัด TPM<input value={f.tpm_meter} onChange={set('tpm_meter')} className={input} /></label>
          <label className="text-xs text-gray-600">รหัสเครื่องวัดอุณหภูมิ<input value={f.thermometer} onChange={set('thermometer')} className={input} /></label>
        </div>

        <div>
          <div className="text-xs text-gray-600 mb-1">1. อุณหภูมิน้ำมัน (°C) — วัดก่อนวัด %TPM · ช่วงที่ใช้ได้ 150–180 °C</div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {temps.map((v, i) => <input key={i} type="number" inputMode="decimal" step="0.1" value={v} placeholder={`ครั้งที่ ${i + 1}`}
              onChange={(e) => setTemps((t) => t.map((x, j) => (j === i ? e.target.value : x)))} className={input} />)}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {tempResult && tempResult !== 'NA' && <span className={`text-sm font-semibold rounded-lg px-3 py-1.5 ${tempResult === 'FAIL' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>ผลอุณหภูมิ: {tempResult === 'FAIL' ? 'ไม่ผ่าน' : 'ผ่าน'} (ช่วงที่ใช้ได้ {OIL_TEMP_MIN}–{OIL_TEMP_MAX} °C)</span>}
            <button type="button" onClick={() => setTempResult((x) => (x === 'NA' ? autoTemp : 'NA'))} className={`text-xs rounded-lg border px-2.5 py-1.5 ${tempResult === 'NA' ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-600 border-gray-300'}`}>{tempResult === 'NA' ? 'N/A (ต้องระบุเหตุผลในหมายเหตุ)' : 'ไม่ได้วัดอุณหภูมิ (N/A)'}</button>
          </div>
        </div>
        <label className="text-xs text-gray-600 block">2. เวลาที่น้ำมันขึ้นถึง 160 °C (นาที) — อ้างอิง 3 นาที
          <input type="number" inputMode="decimal" step="0.5" min="0" max="120" value={reach} onChange={(e) => setReach(e.target.value)} placeholder="เช่น 3" className={`${input} ${reach !== '' && Number(reach) > 3 ? 'border-amber-400 bg-amber-50' : ''}`} />
          {reach !== '' && Number(reach) > 3 && <span className="text-amber-800">นานกว่า 3 นาทีที่อ้างอิง (บันทึกไว้เพื่อติดตาม ไม่ตัดสินผ่าน/ไม่ผ่าน)</span>}
        </label>
        <div>
          <div className="text-xs text-gray-600 mb-1">3. TPM (%) — ค่าที่วัดจริง 1–3 ครั้ง *</div>
          <div className="grid grid-cols-3 gap-2">
            {tpm.map((v, i) => {
              const s = tpmState(v)
              return <input key={i} type="number" inputMode="decimal" step="0.1" min="0" max="60" value={v} placeholder={`ครั้งที่ ${i + 1}`}
                onChange={(e) => setTpm((t) => t.map((x, j) => (j === i ? e.target.value : x)))}
                className={`${input} ${s === 'FAIL' ? 'border-red-400 bg-red-50' : s === 'WATCH' ? 'border-amber-400 bg-amber-50' : s === 'PASS' ? 'border-green-400 bg-green-50' : ''}`} />
            })}
          </div>
        </div>
        {preview && (
          <div className={`rounded-lg p-2.5 text-sm font-semibold ${OIL_RESULT[preview].cls}`}>
            ผลเบื้องต้น: {OIL_RESULT[preview].label}{worst !== null ? ` (TPM สูงสุด ${worst}%)` : ''}
            {preview === 'FAIL' && <div className="text-xs font-normal mt-0.5">หยุดใช้ → แยกสถานะและติดป้าย HOLD → แจ้งหัวหน้างาน/QC → ระบุ Lot/ถัง → บันทึกสิ่งที่ทำ{user?.auto_ncr ? ' · ระบบจะเปิด NCR เมื่อบันทึก' : ''}</div>}
          </div>
        )}
        {preview === 'FAIL' && (
          <label className="text-xs text-gray-600 block">สิ่งที่ทำทันที *<textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="เช่น หยุดใช้ เปลี่ยนน้ำมันใหม่ กักกันน้ำมันถัง T1" className={input} /></label>
        )}
        <label className="text-xs text-gray-600 block">หมายเหตุ / การประเมิน{preview === 'WATCH' || tempResult === 'NA' ? ' *' : ''}
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </label>
        {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>}
        {canWrite(user) ? (
          <button onClick={save} disabled={saving || !tpmVals.length || !tempResult} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold disabled:opacity-40">
            <Save className="w-5 h-5" />{saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        ) : <div className="text-sm text-gray-500">บัญชีนี้ดูได้อย่างเดียว บันทึกไม่ได้</div>}
        <div className="text-xs text-gray-500">ผู้ตรวจ: <b>{user?.display_name}</b> (บันทึกจากบัญชีที่เข้าสู่ระบบ)</div>
      </div>

      <h2 className="text-sm font-bold text-gray-700 mb-2">บันทึกเดือนนี้</h2>
      <div className="bg-white rounded-xl shadow divide-y divide-gray-100">
        {rows.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">ยังไม่มีบันทึก</div>}
        {rows.map((r) => (
          <div key={r.chk_id} className="p-3 text-sm">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-800">{r.check_date} {r.check_time || ''} · {STAGE_TH[r.stage]} · TPM {r.tpm.join(' / ')}%</div>
                <div className="text-[11px] text-gray-500">
                  {r.chk_id} · {[r.line, r.oil_type, r.tank && `ถัง ${r.tank}`].filter(Boolean).join(' · ') || '-'} · อุณหภูมิ {r.temps.length ? r.temps.join(' / ') + ' °C' : '-'} ({r.temp_result}) · {r.inspector}
                </div>
                {(r.action || r.note) && <div className="text-[11px] text-gray-600">{r.action ? `สิ่งที่ทำ: ${r.action}` : ''}{r.action && r.note ? ' · ' : ''}{r.note || ''}</div>}
                {r.verified_by && <div className={`text-[11px] font-semibold ${r.verify_decision === 'APPROVE' ? 'text-green-700' : 'text-red-700'}`}>ทวนสอบ {r.verify_decision} โดย {r.verified_by}{r.verify_note ? ` — ${r.verify_note}` : ''}</div>}
              </div>
              {r.ncr_id && <Link to={`/ncr/${r.ncr_id}`} className="text-[11px] font-semibold text-red-700 underline">{r.ncr_id}</Link>}
              <Badge cls={OIL_RESULT[r.result].cls}>{OIL_RESULT[r.result].label}</Badge>
            </div>
            {isQA(user) && !r.verified_by && <VerifyBox row={r} onDone={load} />}
          </div>
        ))}
      </div>
    </Layout>
  )
}
