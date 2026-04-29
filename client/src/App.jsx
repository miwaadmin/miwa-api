import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext'
import AppErrorBoundary from './components/AppErrorBoundary'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import Dashboard from './pages/Dashboard'
import Patients from './pages/Patients'
import PatientDetail from './pages/PatientDetail'
import SessionNote from './pages/SessionNote'
import Supervisor from './pages/Supervisor'
import Settings from './pages/Settings'
import Billing from './pages/Billing'
import Workspace from './pages/Workspace'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import Bootstrap from './pages/Bootstrap'
import UnsignedSessions from './pages/UnsignedSessions'
import Home from './pages/Home'
import AdminLogin from './pages/AdminLogin'
import AdminOverview from './pages/admin/AdminOverview'
import AdminAccounts from './pages/admin/AdminAccounts'
import AdminUsage from './pages/admin/AdminUsage'
import AdminSupport from './pages/admin/AdminSupport'
import AdminBilling from './pages/admin/AdminBilling'
import Outcomes from './pages/Outcomes'
import Schedule from './pages/Schedule'
import Hours from './pages/Hours'
import Pricing from './pages/Pricing'
import About from './pages/About'
import Templates from './pages/Templates'
import PublicAssessment from './pages/PublicAssessment'
import PublicLethalityScreen from './pages/PublicLethalityScreen'
import PublicNetwork from './pages/PublicNetwork'
import CheckinForm from './pages/CheckinForm'
import ClientPortal from './pages/ClientPortal'
import Briefs from './pages/Briefs'
import Contacts from './pages/Contacts'
import FeaturesPage from './pages/FeaturesPage'
import ForTrainees from './pages/ForTrainees'
import ForLicensedClinicians from './pages/ForLicensedClinicians'
import ForPractices from './pages/ForPractices'
import Docs from './pages/Docs'
import Security from './pages/Security'
import Privacy from './pages/Privacy'
import SmsPolicy from './pages/SmsPolicy'
import DeleteAccount from './pages/DeleteAccount'
import TaskDetail from './pages/TaskDetail'
import AnalyticsTracker from './components/AnalyticsTracker'
import ScrollToTop from './components/ScrollToTop'
import Resources from './pages/Resources'
import DashboardResources from './pages/DashboardResources'
// Practice pages removed — group practice is a separate product (practice.miwa.care)

// Mobile-optimized experience
import MobileLayout from './components/MobileLayout'
import MobileToday from './pages/mobile/MobileToday'
import MobileRecord from './pages/mobile/MobileRecord'
import MobileClients from './pages/mobile/MobileClients'
import MobileMiwa from './pages/mobile/MobileMiwa'
import MobileMore from './pages/mobile/MobileMore'
import MobilePatientDetail from './pages/mobile/MobilePatientDetail'
import MobileSessionNote from './pages/mobile/MobileSessionNote'
import MobileSettings from './pages/mobile/MobileSettings'
import MobileSchedule from './pages/mobile/MobileSchedule'
import MobileConsult from './pages/mobile/MobileConsult'
import MobileOutcomes from './pages/mobile/MobileOutcomes'
import MobileLogin from './pages/mobile/MobileLogin'
import MobileRegister from './pages/mobile/MobileRegister'
import MobileAbout from './pages/mobile/MobileAbout'
import MobileSecurity from './pages/mobile/MobileSecurity'
import MobilePrivacy from './pages/mobile/MobilePrivacy'
import MobileForgotPassword from './pages/mobile/MobileForgotPassword'
import MobileResetPassword from './pages/mobile/MobileResetPassword'
import MobileVerifyEmail from './pages/mobile/MobileVerifyEmail'
import MobileBilling from './pages/mobile/MobileBilling'
import MobileUnsigned from './pages/mobile/MobileUnsigned'
import MobileTaskDetail from './pages/mobile/MobileTaskDetail'
import MobileLibrary from './pages/mobile/MobileLibrary'
import MobileContacts from './pages/mobile/MobileContacts'
import MobileBriefs from './pages/mobile/MobileBriefs'
import MobileWorkspace from './pages/mobile/MobileWorkspace'

// Detect Capacitor native shell only (mobile web browsers return false)
const isNative = () => { try { return !!window.Capacitor?.isNativePlatform?.() } catch { return false } }
// Detect *actual* mobile devices: native shell, OR touch-primary device with a
// narrow viewport. A desktop browser whose window happens to be < 768px wide
// (tabs, devtools, narrow display) is NOT mobile — it has a fine pointer (mouse
// or trackpad) and should stay on the desktop UI.
const isMobileDevice = () => {
  if (isNative()) return true
  try {
    const touchPrimary = window.matchMedia?.('(pointer: coarse)')?.matches
    return !!touchPrimary && window.innerWidth < 768
  } catch { return false }
}

function ProtectedRoute({ children }) {
  const { therapist, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #1a1456, #221a6e)' }}>
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/50 text-sm">Loading Miwa…</p>
        </div>
      </div>
    )
  }
  if (!therapist) return <Navigate to="/login" replace />
  return children
}

// Redirect logged-in users away from public landing pages
function PublicRoute({ children }) {
  const { therapist, isLoading } = useAuth()
  if (isLoading) return null
  if (therapist) return <Navigate to="/dashboard" replace />
  return children
}

// Admin portal — independent session via miwa_admin_auth cookie
function ProtectedAdminRoute({ children }) {
  const { admin, isLoading } = useAdminAuth()
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #0a0818, #1a1456)' }}>
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/40 text-sm">Loading Admin…</p>
        </div>
      </div>
    )
  }
  if (!admin) return <Navigate to="/admin/login" replace />
  return children
}

// Auto-redirect mobile users from /dashboard to /m
function MobileDashboardRedirect() {
  if (isMobileDevice()) return <Navigate to="/m" replace />
  return <Dashboard />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AdminAuthProvider>
          <AppErrorBoundary>
            <AnalyticsTracker />
            <ScrollToTop />
            <Routes>
              {/* Public / marketing routes — native app skips homepage, goes to login */}
              <Route path="/" element={isNative() ? <Navigate to="/login" replace /> : <Home />} />
              <Route path="/login" element={<PublicRoute>{isMobileDevice() ? <MobileLogin /> : <Login />}</PublicRoute>} />
              <Route path="/register" element={<PublicRoute>{isMobileDevice() ? <MobileRegister /> : <Register />}</PublicRoute>} />
              <Route path="/forgot-password" element={<PublicRoute>{isMobileDevice() ? <MobileForgotPassword /> : <ForgotPassword />}</PublicRoute>} />
              <Route path="/reset-password" element={isMobileDevice() ? <MobileResetPassword /> : <ResetPassword />} />
              <Route path="/verify-email" element={isMobileDevice() ? <MobileVerifyEmail /> : <VerifyEmail />} />
              <Route path="/bootstrap" element={<Bootstrap />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/about" element={isMobileDevice() ? <MobileAbout /> : <About />} />
              <Route path="/features" element={<FeaturesPage />} />
              <Route path="/for-trainees" element={<ForTrainees />} />
              <Route path="/for-licensed-clinicians" element={<ForLicensedClinicians />} />
              <Route path="/for-practices" element={<ForPractices />} />
              <Route path="/templates" element={<Templates />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/security" element={isMobileDevice() ? <MobileSecurity /> : <Security />} />
              <Route path="/privacy" element={isMobileDevice() ? <MobilePrivacy /> : <Privacy />} />
              <Route path="/sms-policy" element={<SmsPolicy />} />
              <Route path="/delete-account" element={<DeleteAccount />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/assess/:token" element={<PublicAssessment />} />
              <Route path="/lethality-screen" element={<PublicLethalityScreen />} />
              <Route path="/network" element={<PublicNetwork />} />
              <Route path="/checkin/:token" element={<CheckinForm />} />
              <Route path="/portal/:token" element={<ClientPortal />} />

              {/* Mobile-optimized routes */}
              <Route path="/m" element={<ProtectedRoute><MobileLayout /></ProtectedRoute>}>
                <Route index element={<MobileToday />} />
                <Route path="record" element={<MobileRecord />} />
                <Route path="clients" element={<MobileClients />} />
                <Route path="miwa" element={<MobileMiwa />} />
                <Route path="more" element={<MobileMore />} />
                <Route path="clients/:id" element={<MobilePatientDetail />} />
                <Route path="clients/:id/session/new" element={<MobileSessionNote />} />
                <Route path="clients/:id/session/:sessionId" element={<MobileSessionNote />} />
                <Route path="settings" element={<MobileSettings />} />
                <Route path="schedule" element={<MobileSchedule />} />
                <Route path="consult" element={<MobileConsult />} />
                <Route path="outcomes" element={<MobileOutcomes />} />
                <Route path="billing" element={<MobileBilling />} />
                <Route path="unsigned" element={<MobileUnsigned />} />
                <Route path="library" element={<MobileLibrary />} />
                <Route path="contacts" element={<MobileContacts />} />
                <Route path="briefs" element={<MobileBriefs />} />
                <Route path="workspace" element={<MobileWorkspace />} />
                <Route path="tasks/:id" element={<MobileTaskDetail />} />
              </Route>

              {/* Protected clinician routes */}
              <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<MobileDashboardRedirect />} />
                <Route path="/workspace" element={<Workspace />} />
                <Route path="/patients" element={<Patients />} />
                <Route path="/patients/:id" element={<PatientDetail />} />
                <Route path="/patients/:id/sessions/new" element={<SessionNote />} />
                <Route path="/patients/:id/sessions/:sessionId" element={<SessionNote />} />
                <Route path="/consult" element={<Supervisor />} />
                <Route path="/briefs" element={<Briefs />} />
                <Route path="/library" element={<DashboardResources />} />
                <Route path="/contacts" element={<Contacts />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/outcomes" element={<Outcomes />} />
                <Route path="/calendar" element={<Navigate to="/schedule" replace />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/hours" element={<Hours />} />
                <Route path="/unsigned" element={<UnsignedSessions />} />
                <Route path="/tasks/:id" element={<TaskDetail />} />
                {/* Practice routes removed — separate product */}
              </Route>
              {/* Practice join removed — separate product */}

              {/* Admin portal — independent login + layout */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin" element={<ProtectedAdminRoute><AdminLayout /></ProtectedAdminRoute>}>
                <Route index element={<AdminOverview />} />
                <Route path="accounts" element={<AdminAccounts />} />
                <Route path="usage" element={<AdminUsage />} />
                <Route path="support" element={<AdminSupport />} />
                <Route path="billing" element={<AdminBilling />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppErrorBoundary>
        </AdminAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
