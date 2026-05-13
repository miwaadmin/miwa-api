import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext'
import { ClientAuthProvider } from './context/ClientAuthContext'
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
import AdminSecurity from './pages/admin/AdminSecurity'
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
import Inbox from './pages/Inbox'
import FeaturesPage from './pages/FeaturesPage'
import ForTrainees from './pages/ForTrainees'
import ForLicensedClinicians from './pages/ForLicensedClinicians'
import ForPractices from './pages/ForPractices'
import Docs from './pages/Docs'
import Privacy from './pages/Privacy'
import PrivacyCompliance from './pages/PrivacyCompliance'
import SmsPolicy from './pages/SmsPolicy'
import DeleteAccount from './pages/DeleteAccount'
import TaskDetail from './pages/TaskDetail'
import AnalyticsTracker from './components/AnalyticsTracker'
import ScrollToTop from './components/ScrollToTop'
import Resources from './pages/Resources'
import DashboardResources from './pages/DashboardResources'
import { isNativeApp } from './lib/api'
import { isAgencyCompanionMode, needsTraineeOnboarding, needsWorkspaceModeOnboarding } from './lib/workspaceMode'
import {
  TraineeCases,
  TraineeHours,
  TraineeLearning,
  TraineeSupervision,
  TraineeToday,
} from './pages/trainee/TraineePages'
import TraineeWelcome from './pages/trainee/TraineeWelcome'
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
import {
  ClientAcceptInvite,
  ClientAppointments,
  ClientAssessments,
  ClientDocuments,
  ClientHome,
  ClientHomework,
  ClientLogin,
  ClientMessages,
  ClientProtectedRoute,
  ClientPreview,
  ClientRedeem,
  ClientResources,
  ClientResetPassword,
  ClientSettings,
} from './pages/client/ClientPortalPages'

// Detect Capacitor native shell only (mobile web browsers return false)
const isNative = isNativeApp
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

function DashboardRedirect() {
  const { therapist } = useAuth()
  // Trainees and associates with an incomplete onboarding wizard land on
  // /t/welcome before anything else. This catches both fresh signups and
  // existing trainees migrating to the new wizard.
  if (therapist && needsTraineeOnboarding(therapist)) {
    return <Navigate to="/t/welcome" replace />
  }
  if (!isMobileDevice() && therapist && !needsWorkspaceModeOnboarding(therapist) && isAgencyCompanionMode(therapist)) {
    return <Navigate to="/t/dashboard" replace />
  }
  return <MobileDashboardRedirect />
}

// Wraps every /t/* page (except /t/welcome itself) and routes any trainee with
// an incomplete onboarding wizard into /t/welcome. Keeps the wizard on the
// critical path without requiring a check inside each trainee page component.
function TraineeOnboardingGuard({ children }) {
  const { therapist } = useAuth()
  if (therapist && needsTraineeOnboarding(therapist)) {
    return <Navigate to="/t/welcome" replace />
  }
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AdminAuthProvider>
          <ClientAuthProvider>
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
              <Route path="/security" element={<Navigate to="/privacy-and-compliance" replace />} />
              <Route path="/privacy" element={isMobileDevice() ? <MobilePrivacy /> : <Privacy />} />
              <Route path="/privacy-and-compliance" element={<PrivacyCompliance />} />
              <Route path="/sms-policy" element={<SmsPolicy />} />
              <Route path="/delete-account" element={<DeleteAccount />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/assess/:token" element={<PublicAssessment />} />
              <Route path="/lethality-screen" element={<PublicLethalityScreen />} />
              <Route path="/network" element={<PublicNetwork />} />
              <Route path="/checkin/:token" element={<CheckinForm />} />
              <Route path="/portal/:token" element={<ClientPortal />} />
              <Route path="/client/login" element={<ClientLogin />} />
              <Route path="/client/accept-invite" element={<ClientAcceptInvite />} />
              <Route path="/client/join" element={<ClientAcceptInvite />} />
              {/* Code-based portal signup (pairs with /api/client-auth/redeem) */}
              <Route path="/portal/redeem" element={<ClientRedeem />} />
              <Route path="/client/redeem" element={<ClientRedeem />} />
              <Route path="/client/reset-password" element={<ClientResetPassword />} />
              <Route path="/client/home" element={<ClientProtectedRoute><ClientHome /></ClientProtectedRoute>} />
              <Route path="/client/messages" element={<ClientProtectedRoute><ClientMessages /></ClientProtectedRoute>} />
              <Route path="/client/assessments" element={<ClientProtectedRoute><ClientAssessments /></ClientProtectedRoute>} />
              <Route path="/client/homework" element={<ClientProtectedRoute><ClientHomework /></ClientProtectedRoute>} />
              <Route path="/client/documents" element={<ClientProtectedRoute><ClientDocuments /></ClientProtectedRoute>} />
              <Route path="/client/appointments" element={<ClientProtectedRoute><ClientAppointments /></ClientProtectedRoute>} />
              <Route path="/client/resources" element={<ClientProtectedRoute><ClientResources /></ClientProtectedRoute>} />
              <Route path="/client/settings" element={<ClientProtectedRoute><ClientSettings /></ClientProtectedRoute>} />
              <Route path="/client/preview/:patientId" element={<ProtectedRoute><ClientPreview /></ProtectedRoute>} />

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

              {/* Trainee onboarding wizard — full-page, renders outside the
                  standard Layout so the sidebar/header/floating chat are all
                  suppressed for a clean focused experience. */}
              <Route
                path="/t/welcome"
                element={<ProtectedRoute><TraineeWelcome /></ProtectedRoute>}
              />

              {/* Protected clinician routes */}
              <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route path="/dashboard" element={<DashboardRedirect />} />
                <Route path="/t" element={<Navigate to="/t/dashboard" replace />} />
                <Route path="/t/dashboard" element={<TraineeOnboardingGuard><TraineeToday /></TraineeOnboardingGuard>} />
                <Route path="/t/today" element={<Navigate to="/t/dashboard" replace />} />
                <Route path="/t/cases" element={<TraineeOnboardingGuard><TraineeCases /></TraineeOnboardingGuard>} />
                <Route path="/t/workspace" element={<TraineeOnboardingGuard><Workspace /></TraineeOnboardingGuard>} />
                <Route path="/t/supervision" element={<TraineeOnboardingGuard><TraineeSupervision /></TraineeOnboardingGuard>} />
                <Route path="/t/hours" element={<TraineeOnboardingGuard><TraineeHours /></TraineeOnboardingGuard>} />
                <Route path="/t/learning" element={<TraineeOnboardingGuard><TraineeLearning /></TraineeOnboardingGuard>} />
                {/* Trainees get the same logged-in Resources page that licensed
                    clinicians get at /library (DashboardResources), wrapped in
                    the standard Layout for consistent chrome. */}
                <Route path="/t/resources" element={<TraineeOnboardingGuard><DashboardResources /></TraineeOnboardingGuard>} />
                <Route path="/workspace" element={<Workspace />} />
                <Route path="/patients" element={<Patients />} />
                <Route path="/patients/:id" element={<PatientDetail />} />
                <Route path="/patients/:id/sessions/new" element={<SessionNote />} />
                <Route path="/patients/:id/sessions/:sessionId" element={<SessionNote />} />
                <Route path="/consult" element={<Supervisor />} />
                <Route path="/briefs" element={<Briefs />} />
                <Route path="/inbox" element={<Inbox />} />
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
                <Route path="security" element={<AdminSecurity />} />
                <Route path="billing" element={<AdminBilling />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppErrorBoundary>
          </ClientAuthProvider>
        </AdminAuthProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
