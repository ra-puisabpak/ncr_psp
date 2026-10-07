import { API_URL } from '../config'

const TOKEN_KEY = 'psp_ncr_token'
const USER_KEY = 'psp_ncr_user'
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* private mode */ } },
}

export const session = {
  token: () => store.get(TOKEN_KEY),
  user: () => { try { return JSON.parse(store.get(USER_KEY) || 'null') } catch { return null } },
  save: (token, user) => { store.set(TOKEN_KEY, token); store.set(USER_KEY, JSON.stringify(user)) },
  clear: () => { store.del(TOKEN_KEY); store.del(USER_KEY) },
}

async function request(path, options = {}, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  const token = session.token()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers })
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && auth) {
    session.clear()
    window.dispatchEvent(new Event('auth:expired'))
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`)
    err.data = data // e.g. the list of reasons a release was refused
    throw err
  }
  return data
}

// Fetches an image; photos are private, so the request carries the login (or a supplier token in the path).
async function requestBlob(path, { auth = true } = {}) {
  const headers = {}
  const token = session.token()
  if (auth && token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

const post = (path, body, opt) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }, opt)
const patch = (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) })
const enc = encodeURIComponent

export const authApi = {
  login: (username, password) => post('/api/login', { username, password }, { auth: false }),
  setup: (setupKey, body) => request('/api/setup', {
    method: 'POST', body: JSON.stringify(body), headers: { 'X-Setup-Key': setupKey },
  }, { auth: false }),
  me: () => request('/api/me'),
  logout: () => post('/api/logout'),
  changePassword: (current_password, new_password) => post('/api/me/password', { current_password, new_password }),
}

export const userApi = {
  list: () => request('/api/users'),
  create: (body) => post('/api/users', body),
  update: (username, body) => patch(`/api/users/${enc(username)}`, body),
}

export const auditApi = {
  forEntity: (id) => request(`/api/audit?entity_id=${enc(id)}&limit=200`),
}

export const ncrApi = {
  // Loads every record (the server pages 200 at a time).
  list: async (params = {}) => {
    const all = []
    for (let offset = 0; ; offset += 200) {
      const q = new URLSearchParams({ ...params, limit: 200, offset })
      const page = await request(`/api/ncr?${q}`)
      all.push(...(page.items || []))
      if (all.length >= (page.total || 0) || !(page.items || []).length) break
    }
    return all
  },
  get: (id) => request(`/api/ncr/${enc(id)}`),
  create: (body) => post('/api/ncr', body),
  update: (id, body) => patch(`/api/ncr/${enc(id)}`, body),
  supplierLink: (id) => post(`/api/ncr/${enc(id)}/supplier-link`),
  revokeSupplierLink: (id) => post(`/api/ncr/${enc(id)}/supplier-link/revoke`),
  photos: (id) => ({
    list: () => request(`/api/ncr/${enc(id)}/photos`),
    upload: (body) => post(`/api/ncr/${enc(id)}/photos`, body),
    remove: (photoId) => post(`/api/ncr/${enc(id)}/photos/${photoId}/remove`),
    blob: (photoId) => requestBlob(`/api/ncr/${enc(id)}/photos/${photoId}`),
  }),
}

export const capaApi = {
  list: (params = {}) => request(`/api/capa?${new URLSearchParams(params)}`),
  get: (id) => request(`/api/capa/${enc(id)}`),
  create: (body) => post('/api/capa', body),
  update: (id, body) => patch(`/api/capa/${enc(id)}`, body),
  listByNcr: (ncrId) => request(`/api/capa?ncr_id=${enc(ncrId)}`),
  supplierLink: (id) => post(`/api/capa/${enc(id)}/supplier-link`),
  revokeSupplierLink: (id) => post(`/api/capa/${enc(id)}/supplier-link/revoke`),
}

// Used by the supplier reply pages: the token in the link is the only credential.
export const supplierApi = {
  get: (token) => request(`/api/supplier/${enc(token)}`, {}, { auth: false }),
  reply: (token, body) => post(`/api/supplier/${enc(token)}`, body, { auth: false }),
  photoBlob: (token, photoId) => requestBlob(`/api/supplier/${enc(token)}/photos/${photoId}`, { auth: false }),
  // Same shape as ncrApi.photos(), for the photo picker on the supplier reply page.
  photos: (token) => ({
    list: () => request(`/api/supplier/${enc(token)}`, {}, { auth: false }).then((d) => d.photos || []),
    upload: (body) => post(`/api/supplier/${enc(token)}/photos`, body, { auth: false }),
    remove: (photoId) => post(`/api/supplier/${enc(token)}/photos/${photoId}/remove`, null, { auth: false }),
    blob: (photoId) => requestBlob(`/api/supplier/${enc(token)}/photos/${photoId}`, { auth: false }),
  }),
}

// PSP QUALITY APP: control point register and monitoring records.
export const qaApi = {
  dailyProgress: (date) => request(`/api/daily-progress?date=${date}`),
  controlPoints: () => request('/api/control-points'),
  createControlPoint: (body) => post('/api/control-points', body),
  updateControlPoint: (id, body) => patch(`/api/control-points/${enc(id)}`, body),
  records: (params = {}) => request(`/api/qc?${new URLSearchParams(params)}`),
  summary: (date) => request(`/api/qc/summary?${new URLSearchParams(date ? { date } : {})}`),
  saveRecord: (body) => post('/api/qc', body),
  releaseCheck: (product_code, batch_no) => request(`/api/release/check?${new URLSearchParams({ product_code, batch_no })}`),
  releases: (params = {}) => request(`/api/release?${new URLSearchParams(params)}`),
  saveRelease: (body) => post('/api/release', body),
  recvLots: (days = 120) => request(`/api/recv/lots?days=${days}`),
  trace: (q) => request(`/api/trace?${new URLSearchParams({ q })}`),
}

// PSP QUALITY APP: personal hygiene check before work.
export const hygApi = {
  items: () => request('/api/hyg/items'),
  createItem: (body) => post('/api/hyg/items', body),
  updateItem: (key, body) => patch(`/api/hyg/items/${enc(key)}`, body),
  employees: () => request('/api/hyg/employees'),
  addEmployee: (body) => post('/api/hyg/employees', body),
  updateEmployee: (id, body) => patch(`/api/hyg/employees/${id}`, body),
  records: (params = {}) => request(`/api/hyg/records?${new URLSearchParams(params)}`),
  save: (body) => post('/api/hyg/records', body),
}

// FM-QC-005 frying oil quality and temperature.
export const oilApi = {
  list: (params = {}) => request(`/api/oil?${new URLSearchParams(params)}`),
  save: (body) => post('/api/oil', body),
  verify: (id, body) => post(`/api/oil/${enc(id)}/verify`, body),
}

// FM-QC-006 refrigerator / freezer temperature.
// Central raw-material register (receiving, weighing, traceability, NCR).
export const materialApi = {
  list: () => request('/api/materials'),
  create: (body) => post('/api/materials', body),
  update: (code, body) => patch(`/api/materials/${enc(code)}`, body),
}

// FM-QC-008 finished-product inspection.
export const fgCheckApi = {
  packSizes: () => request('/api/pack-sizes'),
  list: (params = {}) => request(`/api/fgcheck?${new URLSearchParams(params)}`),
  save: (body) => post('/api/fgcheck', body),
}

export const coldApi = {
  units: () => request('/api/cold/units'),
  createUnit: (body) => post('/api/cold/units', body),
  updateUnit: (id, body) => patch(`/api/cold/units/${enc(id)}`, body),
  readings: (params = {}) => request(`/api/cold/readings?${new URLSearchParams(params)}`),
  save: (body) => post('/api/cold/readings', body),
}

// Production formulas and FM-QC-004 raw-material weighing.
export const formulaApi = {
  list: () => request('/api/formulas'),
  create: (body) => post('/api/formulas', body),
  update: (code, body) => patch(`/api/formulas/${enc(code)}`, body),
}
export const weighApi = {
  list: (params = {}) => request(`/api/weigh?${new URLSearchParams(params)}`),
  save: (body) => post('/api/weigh', body),
  signature: (id) => request(`/api/weigh/${enc(id)}/signature`),
  signatures: (id) => request(`/api/weigh/${enc(id)}/signatures`),
}

// FM-QC-002 production control (derives CCP-01 / CCP-02 / OPRP-05 records).
export const prodctlApi = {
  list: (params = {}) => request(`/api/prodctl?${new URLSearchParams(params)}`),
  save: (body) => post('/api/prodctl', body),
}
