import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import MiwaChat from './MiwaChat'
import AppTour from './AppTour'
import { TourProvider } from '../context/TourContext'

export default function Layout() {
  const location = useLocation()
  // Hide MiwaChat on Consult page — Consult IS the deep thinking interface
  const hideChat = location.pathname === '/consult'

  return (
    <TourProvider>
      <div className="app-shell flex h-screen overflow-hidden">
        {/* Sidebar — hidden on mobile, visible on md+ */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Header />
          <main className="app-main flex-1 overflow-y-auto pb-20 md:pb-0 min-h-0">
            <Outlet />
          </main>
        </div>

        {/* Bottom nav — only on mobile */}
        <BottomNav />

        {/* Floating Miwa chat — hidden on Consult page (Consult has its own chat) */}
        {!hideChat && <MiwaChat />}

        {/* Spotlight tour overlay */}
        <AppTour />
      </div>
    </TourProvider>
  )
}
