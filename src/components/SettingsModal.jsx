import { useState, useEffect } from 'react'
import { getGitHubConfig, initGitHub, testConnection } from '../lib/github.js'
import { getSetting, setSetting } from '../lib/db.js'
import { updateLLMConfig } from '../lib/llm.js'

export default function SettingsModal({ open, onClose }) {
  const [token, setToken] = useState('')
  const [proxy, setProxy] = useState('')
  const [timeout, setTimeout_] = useState(15000)
  const [llmApiKey, setLlmApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      const cfg = getGitHubConfig()
      setToken(cfg.token)
      setProxy(cfg.proxy)
      setTimeout_(cfg.timeout)
      getSetting('siliconflow_api_key', '').then(setLlmApiKey)
      setTestResult(null)
      setSaved(false)
    }
  }, [open])

  async function handleSave() {
    await setSetting('github_token', token.trim())
    await setSetting('github_proxy', proxy.trim())
    await setSetting('github_timeout', Number(timeout))
    await setSetting('siliconflow_api_key', llmApiKey.trim())
    initGitHub({ token: token.trim(), proxy: proxy.trim(), timeout: Number(timeout) })
    updateLLMConfig({ apiKey: llmApiKey.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    // 先保存再测试
    await handleSave()
    const start = Date.now()
    try {
      const latency = await testConnection()
      setTestResult({ ok: true, latency })
    } catch (e) {
      setTestResult({ ok: false, latency: Date.now() - start, error: e.message || '连接失败' })
    }
    setTesting(false)
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>设置</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Token */}
          <div className="setting-field">
            <label className="setting-label">
              GitHub Token
              <span className="setting-hint">提升 API 限流到 5000/h（未认证仅 60/h）</span>
            </label>
            <input
              className="setting-input"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
            />
            <a className="setting-link" href="https://github.com/settings/tokens/new?scopes=repo,read:org" target="_blank" rel="noreferrer">
              → 去生成 Token
            </a>
          </div>

          {/* 代理 */}
          <div className="setting-field">
            <label className="setting-label">
              API 代理地址
              <span className="setting-hint">留空即可：开发环境走本地 Clash，生产环境（Vercel）自动走 edge 转发到 GitHub。网络异常时可手动填第三方 CORS 代理</span>
            </label>
            <input
              className="setting-input"
              type="text"
              value={proxy}
              onChange={e => setProxy(e.target.value)}
              placeholder="留空 = 自动（Clash / Vercel edge）"
            />
            <div className="setting-proxy-hints">
              <span className="setting-proxy-label">快捷：</span>
              <button className="setting-proxy-btn" onClick={() => setProxy('')}>自动（推荐）</button>
              <button className="setting-proxy-btn" onClick={() => setProxy('https://ghproxy.com/https://api.github.com')}>ghproxy.com</button>
            </div>
          </div>

          {/* 超时 */}
          <div className="setting-field">
            <label className="setting-label">
              请求超时（毫秒）
              <span className="setting-hint">国内网络建议 20000 以上</span>
            </label>
            <input
              className="setting-input"
              type="number"
              value={timeout}
              onChange={e => setTimeout_(e.target.value)}
              min="5000"
              step="1000"
            />
          </div>

          {/* LLM API Key（可选） */}
          <div className="setting-field">
            <label className="setting-label">
              SiliconFlow API Key（可选）
              <span className="setting-hint">用于 LLM 智能搜索和意图识别。留空则使用默认 Key，也可填写自己的。前往 siliconflow.cn 免费注册获取</span>
            </label>
            <input
              className="setting-input"
              type="password"
              value={llmApiKey}
              onChange={e => setLlmApiKey(e.target.value)}
              placeholder="留空 = 使用默认 Key"
            />
            <a className="setting-link" href="https://cloud.siliconflow.cn/account/ak" target="_blank" rel="noreferrer">
              → 去获取自己的 API Key（免费）
            </a>
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div className={`test-result ${testResult.ok ? 'ok' : 'fail'}`}>
              {testResult.ok
                ? `✅ 连接成功，延迟 ${testResult.latency}ms`
                : `❌ 连接失败（${testResult.latency}ms）：${testResult.error}`}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? '测试中...' : '测试连接'}
          </button>
          <div className="modal-footer-right">
            {saved && <span className="saved-tip">已保存</span>}
            <button className="btn-primary" onClick={handleSave}>保存</button>
          </div>
        </div>
      </div>
    </div>
  )
}
