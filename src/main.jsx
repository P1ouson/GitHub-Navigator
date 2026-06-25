import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { initGitHubFromStorage, hydrateRepoCacheFromStorage } from './lib/github.js'
import { initLLMFromStorage } from './lib/llm.js'
import { getSetting } from './lib/db.js'
import './styles/tokens.css'

// 启动时从本地存储恢复配置（GitHub Token / 代理 / 超时 + LLM 配置）
// 两者都完成后再渲染，避免页面拿到未初始化的 octokit 实例（无 token / 直连）发请求
Promise.all([
  initGitHubFromStorage(getSetting),
  initLLMFromStorage(),
]).then(() => {
  // 从 localStorage 恢复仓库信息缓存
  hydrateRepoCacheFromStorage()
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
})
