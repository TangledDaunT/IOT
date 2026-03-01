/**
 * App.jsx — swipe-based page navigation, no router tab bar.
 *
 * Pages are switched by swiping left/right via PageSwiper.
 * Timer and Settings are lazy-loaded to keep initial bundle small.
 */
import React, { Suspense, lazy } from 'react'

import { RelayProvider }  from './context/RelayContext'
import { ToastProvider }  from './context/ToastContext'
import { RobotProvider }  from './context/RobotContext'
import { VoiceProvider }  from './context/VoiceContext'
import { EXPRESSIONS }    from './context/RobotContext'

import Layout      from './components/layout/Layout'
import PageSwiper  from './components/PageSwiper'
import Dashboard   from './pages/Dashboard'

const Timer    = lazy(() => import('./pages/Timer'))
const Settings = lazy(() => import('./pages/Settings'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center w-full h-full text-slate-500">
      <span className="w-7 h-7 border-2 border-current border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Pages definition — order = swipe order
const PAGES = [
  {
    key: 'dashboard',
    label: 'Control',
    component: Dashboard,
    expr: EXPRESSIONS.IDLE,
  },
  {
    key: 'timer',
    label: 'Timer',
    component: () => (
      <Suspense fallback={<PageLoader />}>
        <Timer />
      </Suspense>
    ),
    expr: EXPRESSIONS.THINKING,
  },
  {
    key: 'settings',
    label: 'Settings',
    component: () => (
      <Suspense fallback={<PageLoader />}>
        <Settings />
      </Suspense>
    ),
    expr: EXPRESSIONS.HAPPY,
  },
]

export default function App() {
  return (
    <RobotProvider>
      <ToastProvider>
        <RelayProvider>
          <VoiceProvider>
            <Layout>
              <PageSwiper pages={PAGES} />
            </Layout>
          </VoiceProvider>
        </RelayProvider>
      </ToastProvider>
    </RobotProvider>
  )
}
