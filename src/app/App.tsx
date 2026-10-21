import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './layout/AppShell'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'

/**
 * App UI 路由表：三个一级页（今天 / 签到记录 / 设置）走底部 Tab，
 * 新增页面：在 pages/ 下建文件 → 在这里挂一条 Route，并同步 AppShell 的 TABS 与 ROOT_ROUTES。
 */
export function App() {
  return (
    <Routes>
      {/* 沉浸式页（不套 AppShell：游戏对局 / 沉浸式播放器等）挂在下面这行之前——
          它们自己用 `h-screen-dvh` 铺满可视区；`assemble-scenario.mjs` 里 `shell: false` 的路由会自动插到这里
          （游戏也可以留在 AppShell 内做壳内形态，见 ui-design-skill 的 05 §0） */}
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
