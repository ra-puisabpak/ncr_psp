// Company and form settings. Change these to match the controlled-document register.
export const API_URL = import.meta.env.VITE_API_URL || 'https://puisabpak-ncr-api.rapuisabpak.workers.dev'
export const COMPANY_NAME = 'บริษัท พระจันทร์๕๐ จำกัด'
export const COMPANY_NAME_EN = 'Puisabpak'
export const COMPANY_SHORT = 'PSP'
export const LOGO_URL = '/logo.png'
export const FORM_CODE_NCR = 'FM-QA-001'
export const FORM_CODE_CAPA = 'FM-QA-005'
export const FORM_REVISION = '00'
// FM-QC-001 receiving inspection app: its own page on this site (public/receiving/), same login.
export const RECEIVING_URL = '/receiving/'
// Personal hygiene check record. Not yet in the QP-HA-001 record list: set the code once DCC assigns one.
export const FORM_CODE_HYGIENE = ''
