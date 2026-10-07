import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './auth'
import NCRListPage from './pages/NCRListPage'
import NCRPrintPage from './pages/NCRPrintPage'
import NCRDetailPage from './pages/NCRDetailPage'
import CAPAListPage from './pages/CAPAListPage'
import CAPAPrintPage from './pages/CAPAPrintPage'
import CAPADetailPage from './pages/CAPADetailPage'
import SupplierReplyPage from './pages/SupplierReplyPage'
import SupplierCAPAReplyPage from './pages/SupplierCAPAReplyPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import UsersPage from './pages/UsersPage'
import MaterialsPage from './pages/MaterialsPage'
import FGCheckPage from './pages/FGCheckPage'
import FGCheckReportPage from './pages/FGCheckReportPage'
import AccountPage from './pages/AccountPage'
import QADashboardPage from './pages/QADashboardPage'
import QCRecordPage from './pages/QCRecordPage'
import QCRecordsPage from './pages/QCRecordsPage'
import ControlPointsPage from './pages/ControlPointsPage'
import FGReleasePage from './pages/FGReleasePage'
import TracePage from './pages/TracePage'
import HygienePage from './pages/HygienePage'
import HygieneReportPage from './pages/HygieneReportPage'
import HygieneSetupPage from './pages/HygieneSetupPage'
import OilPage from './pages/OilPage'
import OilReportPage from './pages/OilReportPage'
import ColdPage from './pages/ColdPage'
import ColdUnitsPage from './pages/ColdUnitsPage'
import ColdReportPage from './pages/ColdReportPage'
import WeighPage from './pages/WeighPage'
import WeighPrintPage from './pages/WeighPrintPage'
import WeighDayPage from './pages/WeighDayPage'
import FormulasPage from './pages/FormulasPage'
import ProdControlPage from './pages/ProdControlPage'
import ProdControlReportPage from './pages/ProdControlReportPage'

const Private = ({ children, role }) => <RequireAuth role={role}>{children}</RequireAuth>

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public: sign-in, first-time setup, and supplier reply links (token after #) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/reply" element={<SupplierReplyPage />} />
          <Route path="/capa-reply" element={<SupplierCAPAReplyPage />} />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Private><DashboardPage /></Private>} />
          <Route path="/ncr" element={<Private><NCRListPage /></Private>} />
          <Route path="/ncr/new" element={<Private><NCRDetailPage /></Private>} />
          <Route path="/ncr/:id" element={<Private><NCRDetailPage /></Private>} />
          <Route path="/ncr/:id/print" element={<Private><NCRPrintPage /></Private>} />
          <Route path="/capa" element={<Private><CAPAListPage /></Private>} />
          <Route path="/capa/new" element={<Private><CAPADetailPage /></Private>} />
          <Route path="/capa/:id" element={<Private><CAPADetailPage /></Private>} />
          <Route path="/capa/:id/print" element={<Private><CAPAPrintPage /></Private>} />
          <Route path="/qa" element={<Private><QADashboardPage /></Private>} />
          <Route path="/qa/record/:cpId" element={<Private><QCRecordPage /></Private>} />
          <Route path="/qa/records" element={<Private><QCRecordsPage /></Private>} />
          <Route path="/qa/control-points" element={<Private role="QA_MANAGER"><ControlPointsPage /></Private>} />
          <Route path="/qa/release" element={<Private role="QA_MANAGER"><FGReleasePage /></Private>} />
          <Route path="/qa/trace" element={<Private><TracePage /></Private>} />
          <Route path="/qa/hygiene" element={<Private><HygienePage /></Private>} />
          <Route path="/qa/hygiene/report" element={<Private><HygieneReportPage /></Private>} />
          <Route path="/qa/hygiene/setup" element={<Private><HygieneSetupPage /></Private>} />
          <Route path="/qa/oil" element={<Private><OilPage /></Private>} />
          <Route path="/qa/oil/report" element={<Private><OilReportPage /></Private>} />
          <Route path="/qa/cold" element={<Private><ColdPage /></Private>} />
          <Route path="/qa/cold/units" element={<Private><ColdUnitsPage /></Private>} />
          <Route path="/qa/cold/report" element={<Private><ColdReportPage /></Private>} />
          <Route path="/qa/weigh" element={<Private><WeighPage /></Private>} />
          <Route path="/qa/weigh/day" element={<Private><WeighDayPage /></Private>} />
          <Route path="/qa/weigh/:id/print" element={<Private><WeighPrintPage /></Private>} />
          <Route path="/qa/fgcheck" element={<Private><FGCheckPage /></Private>} />
          <Route path="/qa/fgcheck/report" element={<Private><FGCheckReportPage /></Private>} />
          <Route path="/qa/materials" element={<Private><MaterialsPage /></Private>} />
          <Route path="/qa/formulas" element={<Private><FormulasPage /></Private>} />
          <Route path="/qa/prodctl" element={<Private><ProdControlPage /></Private>} />
          <Route path="/qa/prodctl/report" element={<Private><ProdControlReportPage /></Private>} />
          <Route path="/account" element={<Private><AccountPage /></Private>} />
          <Route path="/users" element={<Private role="QA_MANAGER"><UsersPage /></Private>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
