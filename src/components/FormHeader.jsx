import { LOGO_URL, COMPANY_NAME, COMPANY_NAME_EN } from '../config'

const NAVY = '#0f2744'
const bd = '1px solid #9aa5b1'

// The common header of every printed form, in the style of the daily receiving report:
// company block | title (Thai + English) | document code / revision / report type.
export function FormHeader({ form, title, en, dept = 'Quality Control (QC)', type, ref2 }) {
  const rows = [['รหัสแบบฟอร์ม', form.code], ...(ref2 ? [['เอกสารอ้างอิง', ref2]] : [['แก้ไขครั้งที่', form.rev]]), ['ประเภทรายงาน', type]].filter((r) => r[1])
  return (
    <div className="avoid-break" style={{ display: 'grid', gridTemplateColumns: '28% 1fr 27%', border: `1.5px solid ${NAVY}`, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRight: bd }}>
        <img src={LOGO_URL} alt="" style={{ height: 38, width: 38, objectFit: 'contain' }} />
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 12, lineHeight: 1.2 }}>{COMPANY_NAME.replace('พระจันทร์', 'พระจันทร์ ')}<div style={{ fontWeight: 400, fontSize: 8.5, color: '#5c6470' }}>{COMPANY_NAME_EN} — {dept}</div></div>
      </div>
      <div style={{ textAlign: 'center', padding: '4px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontWeight: 700, color: NAVY, fontSize: 14, lineHeight: 1.25 }}>{title}</div>
        {en && <div style={{ fontSize: 8.5, letterSpacing: 0.5, color: '#5c6470', textTransform: 'uppercase' }}>{en}</div>}
      </div>
      <div style={{ borderLeft: bd, fontSize: 9.5 }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px', borderTop: i ? bd : 0, background: i % 2 ? '#fff' : '#f4f6f8' }}>
            <span style={{ color: '#5c6470' }}>{k}</span><b style={{ color: NAVY }}>{v}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

// A boxed line under the header: "label: value" pairs.
export function FormInfo({ items }) {
  return (
    <div className="avoid-break" style={{ border: bd, padding: '3px 8px', marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '2px 22px', fontSize: 10.5 }}>
      {items.filter(Boolean).map(([k, v]) => <div key={k}><b style={{ color: NAVY }}>{k}:</b> {v}</div>)}
    </div>
  )
}

// Summary tiles: [[number, label, colour?], ...]
export function FormStats({ items }) {
  return (
    <div className="avoid-break" style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, border: bd, marginBottom: 6 }}>
      {items.map(([n, l, c], i) => (
        <div key={l} style={{ textAlign: 'center', padding: '3px 2px', borderLeft: i ? bd : 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1, color: c || NAVY }}>{n}</div>
          <div style={{ fontSize: 9, color: '#5c6470' }}>{l}</div>
        </div>
      ))}
    </div>
  )
}
