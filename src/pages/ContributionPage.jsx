import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseGithubRepoCoordinates, forkRepo, getUpstreamIssues, getIssueDetail, getCurrentUser, getRepoInfo } from '../lib/github.js'
import { addContribution } from '../lib/db.js'
import { useScrollReveal } from '../lib/useScrollReveal.js'
import { chatStream } from '../lib/llm.js'

export default function ContributionPage() {
  const [url, setUrl] = useState('')
  const [step, setStep] = useState(0) // 0=Fork, 1=选Issue, 2=本地开发, 3=填PR, 4=成功
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [repo, setRepo] = useState(null)
  const [forkInfo, setForkInfo] = useState(null)
  const [issues, setIssues] = useState([])
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [user, setUser] = useState(null)
  const [useSSH, setUseSSH] = useState(false)
  const [prForm, setPrForm] = useState({ title: '', body: '', head: '' })
  const [commitMsg, setCommitMsg] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)

  useScrollReveal()

  // URL 参数支持：从 URL 读取仓库地址
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const urlParam = searchParams.get('url')
    if (urlParam && !url) {
      setUrl(urlParam)
    }
  }, [])

  function startTimer() { setElapsed(0); let s = 0; timerRef.current = setInterval(() => { s++; setElapsed(s) }, 1000) }
  function stopTimer() { clearInterval(timerRef.current); timerRef.current = null; setElapsed(0) }
  useEffect(() => () => clearInterval(timerRef.current), [])

  // ─── Step 0: Fork ───
  async function handleFork() {
    if (!url.trim()) return
    const parsed = parseGithubRepoCoordinates(url)
    if (!parsed) { setError('无法解析仓库地址'); return }
    setRepo(parsed)
    setLoading('fork'); setError(''); setIssues([]); setSelectedIssue(null)
    startTimer()
    try {
      const info = await forkRepo(parsed.owner, parsed.repo)
      setForkInfo(info)
      // 获取仓库 stars/language 存入贡献记录（用于质量评估和技能树）
      let stars = null, language = null
      try {
        const repoInfo = await getRepoInfo(parsed.owner, parsed.repo)
        stars = repoInfo.stars
        language = repoInfo.language
      } catch { /* 静默：获取仓库信息失败不影响 Fork 流程 */ }
      addContribution({
        type: 'fork',
        repo: `${parsed.owner}/${parsed.repo}`,
        detail: info.name,
        stars,
        language,
      })
      getCurrentUser().then(u => setUser(u)).catch(() => {})
      setStep(1) // 自动进入下一步
    } catch (e) { setError(`Fork 失败：${e.message}`) }
    finally { stopTimer(); setLoading('') }
  }

  // ─── Step 1: 加载 Issues ───
  async function handleLoadIssues() {
    setError('')
    setLoading('issues')
    try {
      const owner = forkInfo?.upstream?.owner || repo?.owner
      const r = forkInfo?.upstream?.repo || repo?.repo
      if (!owner || !r) { setError('仓库信息缺失，请重新 Fork'); return }
      const list = await getUpstreamIssues(owner, r, { perPage: 20 })
      if (!list.length) setError('该仓库暂无开放 Issue，请稍后再来或换一个仓库')
      setIssues(list)
    } catch (e) { setError(`加载 Issues 失败：${e.message}`) }
    finally { setLoading('') }
  }

  // ─── Step 1 → 2: 选择 Issue ───
  async function handleSelectIssue(issue) {
    setLoading('issue')
    try {
      const owner = forkInfo?.upstream?.owner || repo?.owner
      const r = forkInfo?.upstream?.repo || repo?.repo
      const detail = await getIssueDetail(owner, r, issue.number)
      setSelectedIssue(detail)
      const userLogin = user?.login || 'your-username'
      const branchName = `${userLogin}-issue-${detail.number}`
      setPrForm({
        title: `Fix #${detail.number}: ${detail.title}`,
        head: `${forkInfo?.forkOwner || userLogin}:${branchName}`,
        body: [
          `## Summary`,
          ``,
          `Closes #${detail.number}`,
          ``,
          `## Changes`,
          ``,
          `- `,
          ``,
          `## Related Issue`,
          `- ${detail.title} (#${detail.number})`,
        ].join('\n'),
      })
      setStep(2) // 进入本地开发
    } catch (e) { setError(`获取 Issue 详情失败：${e.message}`) }
    finally { setLoading('') }
  }

  // ─── Step 3 → 4: 提交 PR ───
  async function handleSubmitPR() {
    if (!prForm.title.trim()) { setError('PR 标题不能为空'); return }
    if (!repo) return
    setLoading('pr')
    try {
      const base = forkInfo?.defaultBranch || 'main'
      const head = prForm.head
      const compareUrl = `https://github.com/${repo.owner}/${repo.repo}/compare/${base}...${head}?title=${encodeURIComponent(prForm.title)}&body=${encodeURIComponent(prForm.body)}&expand=1`
      window.open(compareUrl, '_blank')
      setStep(4)
      // 记录 PR 贡献，包含关联的 Issue 编号和仓库语言
      addContribution({
        type: 'pr',
        repo: `${repo.owner}/${repo.repo}`,
        detail: prForm.title,
        issueNumber: selectedIssue?.number || null,
        language: forkInfo?.language || null,
        status: 'open', // PR 刚提交时状态为 open
      })
    } catch (e) { setError(`PR 提交失败：${e.message}`) }
    finally { setLoading('') }
  }

  // ─── AI 润色 PR 描述
  async function handlePolishPR() {
    if (!prForm.body.trim() || polishing) return
    setPolishing(true)
    const systemPrompt = `你是一个技术文档撰写专家。请润色以下 PR 描述，使其更专业、清晰、有条理。
要求：
1. 保持原有的 Summary / Changes / Related Issue 结构
2. 补充更多上下文和技术细节，让维护者更容易理解这个 PR 的价值
3. 用中文润色（如果原文是英文，翻译成中文）
4. 保留原有的 Closes #xxx 引用
5. 只输出润色后的内容，不要加任何解释`
    let result = ''
    await chatStream(systemPrompt, prForm.body, (chunk) => {
      result += chunk
      setPrForm(prev => ({ ...prev, body: result }))
    }, 1024)
    if (!result) setError('AI 润色失败，请检查 LLM 配置')
    setPolishing(false)
  }

  // ─── 派生数据 ───
  const cloneUrl = useSSH ? forkInfo?.sshUrl : forkInfo?.cloneUrl
  const userLogin = user?.login || 'your-username'
  const branchName = selectedIssue ? `${userLogin}-issue-${selectedIssue.number}` : 'your-feature-branch'
  const repoName = forkInfo?.name?.split('/')[1] || 'repo'

  const gitCommands = forkInfo
    ? [
        `git clone ${cloneUrl}`,
        `cd ${repoName}`,
      ].join('\n')
    : ''

  const commitCommands = forkInfo
    ? [
        `git checkout -b ${branchName}`,
        `# 修改代码...`,
        `git add .`,
        `git commit -m "${commitMsg || `fix: resolve #${selectedIssue?.number || 'n'} -- 简要描述修改`}"`,
        `git push origin ${branchName}`,
      ].join('\n')
    : ''

  return (
    <section className="section">
      <div className="section-inner">
        <div className="section-header" data-reveal>
          <div className="section-label">模块三</div>
          <h2>贡献助手</h2>
          <p>Fork → 选择 Issue → 本地开发 → 创建 PR，四步完成第一次开源贡献</p>
        </div>

        {/* 流程条 */}
        <div className="flow-strip" data-reveal>
          <FlowStep num={1} label="Fork 仓库" active={step >= 0} done={step >= 1} />
          <FlowArrow />
          <FlowStep num={2} label="选择 Issue" active={step >= 1} done={step >= 2} />
          <FlowArrow />
          <FlowStep num={3} label="本地开发" active={step >= 2} done={step >= 3} />
          <FlowArrow />
          <FlowStep num={4} label="提交 PR" active={step >= 3} done={step >= 4} />
        </div>

        {error && <div className="search-status error">{error}</div>}

        {/* ═══════════════════════════════════════════
            Step 0: Fork 仓库
            ═══════════════════════════════════════════ */}
        {step === 0 && (
          <div className="step-card">
            <div className="step-card-header">
              <span className="step-card-num">1</span>
              <span className="step-card-title">Fork 仓库</span>
              <span className="step-card-desc">将目标仓库复制到你的 GitHub 账户下</span>
            </div>
            <div className="step-card-body">
              <div className="contribute-input">
                <input className="search-box-input" value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFork()}
                  placeholder="owner/repo 或 https://github.com/owner/repo"
                  disabled={loading === 'fork'} />
                <button className="search-box-btn" onClick={handleFork} disabled={loading === 'fork'}>
                  {loading === 'fork' ? 'Fork 中...' : '一键 Fork'}
                </button>
              </div>

              {loading === 'fork' && elapsed > 0 && (
                <div className="progress-section">
                  <div className="progress-track"><div className="progress-fill" /></div>
                  <div className="progress-text">
                    GitHub 正在 Fork 仓库... 已等待 {elapsed}s
                    {elapsed > 15 && <span className="progress-hint">（大型仓库 Fork 较慢）</span>}
                  </div>
                </div>
              )}

              <div className="step-card-tip">
                Fork 相当于在你自己账户下创建一份仓库副本，之后的所有修改都在你的副本上进行
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            Step 1: 选择 Issue
            ═══════════════════════════════════════════ */}
        {step >= 1 && step < 4 && (
          <>
            {/* Fork 成功提示 */}
            <div className="step-done-bar">
              <span>✅ Fork 完成：</span>
              <a className="inline-link" href={forkInfo?.url}
                onClick={e => { e.preventDefault(); window.open(forkInfo?.url, '_blank') }}>
                {forkInfo?.name}
              </a>
              <span className="step-done-extra">（已复制到你的账户）</span>
            </div>

            {step === 1 && (
              <div className="step-card">
                <div className="step-card-header">
                  <span className="step-card-num">2</span>
                  <span className="step-card-title">选择 Issue</span>
                  <span className="step-card-desc">从上游仓库挑选一个你要解决的问题</span>
                </div>
                <div className="step-card-body">
                  {issues.length === 0 ? (
                    <>
                      <button className="search-box-btn" onClick={handleLoadIssues} disabled={loading === 'issues'}>
                        {loading === 'issues' ? '加载中...' : '加载上游 Issues'}
                      </button>
                      <div className="step-card-tip">
                        点击按钮从上游仓库拉取可用的 Issue 列表
                      </div>
                    </>
                  ) : (
                    <div className="issue-list">
                      {issues.map(issue => (
                        <button key={issue.number} className="issue-item"
                          onClick={() => handleSelectIssue(issue)} disabled={loading === 'issue'}>
                          <div className="issue-item-title">#{issue.number} {issue.title}</div>
                          <div className="issue-item-meta">
                            {issue.labels?.map(l => (
                              <span key={l.name} className="label-tag"
                                style={{ background: `#${l.color}20`, color: `#${l.color}` }}>
                                {l.name}
                              </span>
                            ))}
                            <span>{new Date(issue.createdAt).toLocaleDateString()}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══════════════════════════════════════════
            Step 2: 本地开发
            ═══════════════════════════════════════════ */}
        {selectedIssue && step === 2 && (
          <div className="step-card">
            <div className="step-card-header">
              <span className="step-card-num">3</span>
              <span className="step-card-title">本地开发</span>
              <span className="step-card-desc">在终端中克隆仓库、修改代码、提交推送</span>
            </div>

            {/* 选中的 Issue 摘要 */}
            <div className="step-issue-summary">
              <span className="step-issue-num">#{selectedIssue.number}</span>
              <span className="step-issue-title">{selectedIssue.title}</span>
              {selectedIssue.labels?.map(l => (
                <span key={l.name} className="label-tag"
                  style={{ background: `#${l.color}20`, color: `#${l.color}` }}>
                  {l.name}
                </span>
              ))}
            </div>

            <div className="step-card-body">
              {/* 克隆方式 */}
              <div className="clone-toggle">
                <span className="clone-toggle-label">克隆方式：</span>
                <button className={`clone-toggle-btn${!useSSH ? ' active' : ''}`} onClick={() => setUseSSH(false)}>HTTPS</button>
                <button className={`clone-toggle-btn${useSSH ? ' active' : ''}`} onClick={() => setUseSSH(true)}>SSH</button>
              </div>

              {/* 克隆命令 */}
              <div className="clone-card">
                <div className="clone-card-header">
                  <span>1. 克隆仓库</span>
                  <button className="clone-copy-btn" onClick={() => navigator.clipboard.writeText(gitCommands)}>
                    📋 复制
                  </button>
                </div>
                <textarea className="clone-textarea" value={gitCommands} readOnly rows={2}
                  onClick={e => e.target.select()} />
                <p className="clone-hint">
                  逐条复制执行。克隆后仓库会出现在当前目录的 <code>{repoName}</code> 文件夹
                </p>
              </div>

              {/* 提交命令 */}
              <div className="clone-card">
                <div className="clone-card-header">
                  <span>2. 修改并提交</span>
                  <button className="clone-copy-btn" onClick={() => navigator.clipboard.writeText(commitCommands)}>
                    📋 复制
                  </button>
                </div>
                <textarea className="clone-textarea" value={commitCommands} readOnly rows={5}
                  onClick={e => e.target.select()} />
                <p className="clone-hint">
                  <strong>逐条复制执行</strong>。修改代码后，提交并推送到分支 <code>{branchName}</code>
                </p>
              </div>

              {/* Commit Message */}
              <div className="pr-field">
                <label className="pr-label">
                  Commit Message
                  <span className="data-source">（简要描述你的修改）</span>
                </label>
                <input className="setting-input"
                  placeholder={`fix: resolve #${selectedIssue.number} ...`}
                  value={commitMsg} onChange={e => setCommitMsg(e.target.value)} />
              </div>

              <div className="contribute-actions">
                <button className="btn-primary" onClick={() => setStep(3)}>
                  下一步：提交 PR
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            Step 3: 提交 PR
            ═══════════════════════════════════════════ */}
        {selectedIssue && step === 3 && (
          <div className="step-card">
            <div className="step-card-header">
              <span className="step-card-num">4</span>
              <span className="step-card-title">提交 PR</span>
              <span className="step-card-desc">确认信息无误后，提交 Pull Request</span>
            </div>

            <div className="step-card-body">
              {/* 完成确认 */}
              <div className="step-review">
                <div className="step-review-title">请在提交前确认：</div>
                <div className="step-review-items">
                  <div className="step-review-item">
                    <span className="step-review-label">Fork 仓库</span>
                    <code>{forkInfo?.name}</code>
                  </div>
                  <div className="step-review-item">
                    <span className="step-review-label">Issue</span>
                    <code>#{selectedIssue.number} {selectedIssue.title}</code>
                  </div>
                  <div className="step-review-item">
                    <span className="step-review-label">分支</span>
                    <code>{branchName}</code>
                  </div>
                  <div className="step-review-item">
                    <span className="step-review-label">推送命令</span>
                    <code>git push origin {branchName}</code>
                  </div>
                  <div className="step-review-item">
                    <span className="step-review-label">Commit</span>
                    <code>{commitMsg || '(未填写)'}</code>
                  </div>
                </div>
              </div>

              {/* PR 表单 */}
              <div className="pr-form">
                <div className="pr-field">
                  <label className="pr-label">PR 标题</label>
                  <input className="setting-input" value={prForm.title}
                    onChange={e => setPrForm(prev => ({ ...prev, title: e.target.value }))} />
                </div>
                <div className="pr-field">
                  <label className="pr-label">
                    PR 描述
                    <span className="data-source">（已自动关联 Issue）</span>
                  </label>
                  <textarea className="pr-textarea" value={prForm.body}
                    onChange={e => setPrForm(prev => ({ ...prev, body: e.target.value }))} rows={10} />
                  <button className="clone-copy-btn" onClick={handlePolishPR} disabled={polishing || !prForm.body.trim()}>
                    {polishing ? '✨ AI 润色中...' : '✨ AI 润色描述'}
                  </button>
                </div>
                <div className="pr-field">
                  <label className="pr-label">来源分支</label>
                  <input className="setting-input" value={prForm.head}
                    onChange={e => setPrForm(prev => ({ ...prev, head: e.target.value }))} />
                </div>
              </div>

              <div className="contribute-actions">
                <button className="btn-secondary" onClick={() => setStep(2)}>← 返回上一步</button>
                <button className="btn-primary" onClick={handleSubmitPR} disabled={loading === 'pr'}>
                  {loading === 'pr' ? '提交中...' : '提交 PR 到 GitHub'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            Step 4: 完成
            ═══════════════════════════════════════════ */}
        {step === 4 && (
          <div className="step-card step-card-success">
            <div className="step-done-hero">
              <span className="step-done-icon">🎉</span>
              <div className="step-done-title">PR 已提交！</div>
              <div className="step-done-desc">
                在 GitHub 上查看并完善你的 Pull Request，等待仓库维护者审核
              </div>
              <div className="step-done-actions">
                <button className="btn-primary" onClick={() => { setStep(0); setForkInfo(null); setIssues([]); setSelectedIssue(null); setUrl(''); setCommitMsg('') }}>
                  开始新的贡献
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function FlowStep({ num, label, active, done }) {
  let cls = 'flow-step'
  if (done) cls += ' done'
  else if (active) cls += ' active'
  return (
    <div className={cls}>
      <div className="flow-num">{done ? '✓' : num}</div>
      <div className="flow-label">{label}</div>
    </div>
  )
}
function FlowArrow() { return <div className="flow-arrow">→</div> }