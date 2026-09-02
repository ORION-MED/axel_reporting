import { createBrowserRouter } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'

const DatasetsPage = lazy(() => import('@pages/datasets').then((m) => ({ default: m.DatasetsPage })))
const StatsPage = lazy(() => import('@pages/stats').then((m) => ({ default: m.StatsPage })))
const DashboardPage = lazy(() => import('@pages/dashboard').then((m) => ({ default: m.DashboardPage })))
const ReportingPage = lazy(() => import('@pages/reporting').then((m) => ({ default: m.ReportingPage })))
const DatabasePage = lazy(() => import('@pages/database').then((m) => ({ default: m.DatabasePage })))
const DatabaseExplorerPage = lazy(() => import('@pages/database/ui/DatabaseExplorerPage').then((m) => ({ default: m.DatabaseExplorerPage })))
const AuthPage = lazy(() => import('@pages/auth').then((m) => ({ default: m.AuthPage })))
const ProfilePage = lazy(() => import('@pages/profile').then((m) => ({ default: m.ProfilePage })))
const SettingsPage = lazy(() => import('@pages/settings').then((m) => ({ default: m.SettingsPage })))
const SupportPage = lazy(() => import('@pages/support').then((m) => ({ default: m.SupportPage })))
const NewSupportTicketPage = lazy(() => import('@pages/support').then((m) => ({ default: m.NewSupportTicketPage })))
const Layout = lazy(() => import('@widgets/layout').then((m) => ({ default: m.Layout })))

const page = (element: ReactNode) => (
    <Suspense fallback={null}>
        {element}
    </Suspense>
)


export const router = createBrowserRouter([
    {
        path: '/auth',
        element: page(<AuthPage />),
    },
    {
        path: '/',
        element: page(<Layout />),
        children: [
            {
                index: true,
                element: page(<DatasetsPage />),
            },
            {
                // WorkPage is mounted persistently in Layout (keep-alive pattern)
                // to prevent AG Grid re-initialisation on every navigation.
                path: 'work',
                element: <></>,
            },
            {
                path: 'stats',
                element: page(<StatsPage />),
            },
            {
                path: 'profile',
                element: page(<ProfilePage />),
            },
            {
                path: 'settings',
                element: page(<SettingsPage />),
            },
            {
                path: 'support',
                element: page(<SupportPage />),
            },
            {
                path: 'support/new',
                element: page(<NewSupportTicketPage />),
            },
            {
                path: 'dashboard',
                element: page(<DashboardPage />),
            },
            {
                path: 'reporting',
                element: page(<ReportingPage />),
            },
            {
                path: 'database',
                element: page(<DatabasePage />),
            },
            {
                path: 'database/eicu',
                element: page(<DatabaseExplorerPage databaseKey="eicu" />),
            },
            {
                path: 'database/mimic',
                element: page(<DatabaseExplorerPage databaseKey="mimic" />),
            },
            {
                path: 'database/picdb',
                element: page(<DatabaseExplorerPage databaseKey="picdb" />),
            },
        ],
    },
])
