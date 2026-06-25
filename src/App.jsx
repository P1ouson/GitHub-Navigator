import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import HomePage from './pages/HomePage.jsx'
import SearchPage from './pages/SearchPage.jsx'
import AnalysisPage from './pages/AnalysisPage.jsx'
import ContributionPage from './pages/ContributionPage.jsx'
import GrowthPage from './pages/GrowthPage.jsx'
import ProfilePage from './pages/ProfilePage.jsx'
import ExplorePage from './pages/ExplorePage.jsx'

// SocialPage 依赖 react-force-graph-3d + three（gzip ~600KB），懒加载避免拖慢首屏
const SocialPage = lazy(() => import('./pages/SocialPage.jsx'))

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/contribute" element={<ContributionPage />} />
        <Route path="/growth" element={<GrowthPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/social" element={
          <Suspense fallback={null}>
            <SocialPage />
          </Suspense>
        } />
      </Route>
    </Routes>
  )
}
