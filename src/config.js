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
// Record forms of PSP QUALITY APP (codes assigned by DCC). Change a code or revision here only.
export const FORMS = {
  RECEIVING: { code: 'FM-QC-001', rev: '00', name: 'บันทึกการตรวจรับวัตถุดิบ' },
  PRODCTL: { code: 'FM-QC-002', rev: '00', name: 'แบบฟอร์มควบคุมการผลิต' },
  WEIGH: { code: 'FM-QC-004', rev: '01', name: 'บันทึกการชั่งวัตถุดิบ' },
  OIL: { code: 'FM-QC-005', rev: '02', name: 'บันทึกการตรวจสอบคุณภาพน้ำมันทอดและอุณหภูมิ' },
  COLD: { code: 'FM-QC-006', rev: '02', name: 'บันทึกการตรวจสอบอุณหภูมิตู้เย็นและตู้แช่แข็ง' },
  HYGIENE: { code: 'FM-QA-007', rev: '00', name: 'แบบบันทึกการตรวจสุขลักษณะส่วนบุคคลก่อนเข้าปฏิบัติงาน' },
  FG_CHECK: { code: 'FM-QC-008', rev: '00', name: 'บันทึกการตรวจสอบผลิตภัณฑ์สุดท้าย' },
}
