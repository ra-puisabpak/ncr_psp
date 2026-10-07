import { useEffect, useState } from 'react'
import { materialApi } from '../api/d1Api'
import { RAW_MATERIALS, PACKAGING, CONSUMABLES, PRODUCTS } from './masterData'

// The material list comes from the central register; the list built into the app is the fallback
// until the register has loaded (or when offline). Products are not in the register.
export const TYPE_GROUP = { RM: 'วัตถุดิบ', PM: 'บรรจุภัณฑ์', CM: 'วัสดุสิ้นเปลือง' }
const KEY = 'psp_materials'
const builtIn = [
  ...RAW_MATERIALS.map((m) => ({ ...m, group: TYPE_GROUP.RM })),
  ...PACKAGING.map((m) => ({ ...m, group: TYPE_GROUP.PM })),
  ...CONSUMABLES.map((m) => ({ ...m, group: TYPE_GROUP.CM })),
]
const fromRegister = (rows) => rows.map((m) => ({ code: m.code, label: m.name, unit: m.unit || '', storage: m.store || '', group: TYPE_GROUP[m.type] || m.type, active: !!m.active }))
const cached = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return Array.isArray(v) && v.length ? v : null } catch { return null } }

let current = cached() || builtIn
let pending = null
const listeners = new Set()
export function refreshMaterials() {
  pending = pending || materialApi.list().then((rows) => {
    current = fromRegister(rows)
    try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* storage full or blocked */ }
    listeners.forEach((f) => f(current))
  }).catch(() => {}).finally(() => { pending = null })
  return pending
}

// { materials: every material (retired ones included, for names on old records), choices: what can be picked,
//   matLabel: code → name }. NCRs can also be raised against finished products.
export function useMaterials({ withProducts = false } = {}) {
  const [list, setList] = useState(current)
  useEffect(() => { listeners.add(setList); refreshMaterials(); return () => listeners.delete(setList) }, [])
  const all = withProducts ? [...list, ...PRODUCTS.map((p) => ({ ...p, group: 'ผลิตภัณฑ์', active: true }))] : list
  return { materials: all, choices: all.filter((m) => m.active !== false), matLabel: Object.fromEntries(all.map((m) => [m.code, m.label])) }
}
