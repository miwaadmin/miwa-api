import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import MiwaChat from './MiwaChat'
import AppTour from './AppTour'
import WorkspaceModeOnboarding from './WorkspaceModeOnboarding'
import { TourProvider } from '../context/TourContext'

export default function Layout() {
  return (
    <TourProvider>
      <div className="app-shell flex h-screen overflow-hidden">
        {/* Sidebar, hidden on mobile, visible on md+ */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Header />
          <main className="app-main flex-1 overflow-y-auto pb-20 md:pb-0 min-h-0">
            <Outlet />
          </main>
        </div>

        {/* Bottom nav, only on mobile */}
        <BottomNav />

        {/* Floating Miwa chat includes Live voice controls, including on Consult. */}
        <MiwaChat />

        {/* Spotlight tour overlay */}
        <AppTour />

        <WorkspaceModeOnboarding />
      </div>
    </TourProvider>
  )
}
