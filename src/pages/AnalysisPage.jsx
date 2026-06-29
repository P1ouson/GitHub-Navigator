import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { parseRepoUrl, getAnalysisData, fetchReadmeContent } from '../lib/github.js'
import { calcAnalysisScores, assessRepoLiveness } from '../lib/repoHealth.js'
import { chatStream } from '../lib/llm.js'
import { usePersistState } from '../lib/pageCache.js'
import { renderMarkdown } from '../lib/markdown.js'
import { useScrollReveal } from '../lib/useScrollReveal.js'

export default function AnalysisPage() {
  const [url, setUrl] = usePersistState('analysis', 'url', '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = usePersistState('analysis', 'report', null)
  const [urlHint, setUrlHint] = useState('')
  const [llmSummary, setLlmSummary] = usePersistState('analysis', 'llmSummary', '')
  const [llmLoading, setLlmLoading] = useState(false)
  const [activeTab, setActiveTab] = usePersistState('analysis', 'activeTab', 'analysis')

  useScrollReveal()

  // URL 参数支持：初次加载时从 URL 读取仓库地址
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const urlParam = searchParams.get('url')
    if (urlParam && !url) {
      setUrl(urlParam)
      setTimeout(() => analyze(urlParam), 100)
    }
  }, []) // 仅在挂载时执行一次

  // README 翻译状态
  const [readmeRaw, setReadmeRaw] = usePersistState('analysis', 'readmeRaw', '')
  const [readmeName, setReadmeName] = usePersistState('analysis', 'readmeName', '')
  const [translated, setTranslated] = usePersistState('analysis', 'translated', '')
  const [transLoading, setTransLoading] = useState(false)
  const [transProgress, setTransProgress] = useState('')
  const [readmeError, setReadmeError] = useState('')

  // 交互问答状态
  const [qaMessages, setQaMessages] = usePersistState('analysis', 'qaMessages', [])
  const [qaInput, setQaInput] = useState('')
  const [qaLoading, setQaLoading] = useState(false)
  const qaEndRef = useRef(null)

  async function analyze(overrideUrl) {
    const targetUrl = overrideUrl || url
    if (!targetUrl.trim()) return
    setLoading(true)
    setError('')
    setReport(null)
    setLlmSummary('')
    setUrlHint('')

    const parsed = parseRepoUrl(targetUrl)
    if (!parsed) {
      setError('无法解析仓库地址，请输入 owner/repo 或完整 GitHub URL')
      setLoading(false)
      return
    }

    if (parsed.truncated) {
      setUrlHint(`已自动截断为 ${parsed.canonicalUrl}（去掉了 /pulls 等后缀）`)
    }

    try {
      const { owner, repo } = parsed
      const data = await getAnalysisData(owner, repo)

      const liveness = assessRepoLiveness(data)
      const scores = calcAnalysisScores(data)
      const recommendations = buildRecommendations(data, liveness, scores)

      setReport({ ...data, liveness, scores, recommendations })

      // 分析完成后，同步启动 README 翻译 + LLM 画像（后台并行）
      translateReadme(owner, repo)
      generateLLMSummaryStream({ ...data, liveness, scores, recommendations })
    } catch (e) {
      const msg = e.message?.includes('rate limit')
        ? 'GitHub API 限流（未认证 60/h）。请在设置（⚙）中填入 GitHub Token 提升到 5000/h'
        : `分析失败：${e.message}`
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  /** LLM 项目画像 — 流式输出，自然语言描述 */
  async function generateLLMSummaryStream(reportData) {
    setLlmLoading(true)
    setLlmSummary('')

    const { info, liveness, scores, recommendations } = reportData
    const ctx = {
      '仓库名': info.fullName || info.name || '未知',
      '描述': info.desc || '无',
      '主语言': info.language || '未知',
      Stars: info.stars || 0,
      Forks: info.forks || 0,
      Watchers: info.watchers || 0,
      Open_Issues: info.openIssues || 0,
      '协议': info.license || '无',
      '默认分支': info.defaultBranch || 'main',
      '是否存在Fork': info.isFork ? '是' : '否',
      '是否已归档': info.archived ? '是' : '否',
      '话题标签': (info.topics || []).join('、'),
      '活跃度等级': liveness.level || 'unknown',
      '活跃度依据': liveness.basis || '未知',
      '最后活动': liveness.days != null ? `${liveness.days}天前` : '未知',
      '健康度总分': `${scores.total || 0}/100`,
      '各项评分': `活跃度${scores.activity || 0}/20、贡献者${scores.contributors || 0}/15、新手友好${scores.beginner || 0}/20、维护质量${scores.maintenance || 0}/20、文档${scores.docs || 0}/15、生态${scores.ecosystem || 0}/10`,
      '关键问题': (recommendations || []).slice(0, 5).map(r => r.title).join('、'),
      '贡献者数量': reportData.contributorCount || 0,
      '30天提交数': reportData.commits30d || 0,
      'PR中位处理': reportData.prDays != null ? `${reportData.prDays}天` : '无数据',
      'PR合并率': reportData.prMergeRate != null ? `${reportData.prMergeRate}%` : '无数据',
      'Issue中位关闭': reportData.issueCloseDays != null ? `${reportData.issueCloseDays}天` : '无数据',
      'Good_First_Issue数': reportData.gfiCount || 0,
      'Help_Wanted数': reportData.helpWantedCount || 0,
      '是否有README': reportData.hasReadme ? '有' : '无',
      '是否有CONTRIBUTING': reportData.hasContributing ? '有' : '无',
      '是否有Release': reportData.hasReleases ? '有' : '无',
      '仓库年龄': reportData.repoAgeDays != null ? `${Math.floor(reportData.repoAgeDays / 365)}年` : '未知',
    }

    const systemPrompt = `你是一个亲切的开源项目评估专家。请根据以下仓库数据，写一段详细的中文项目画像，可以使用 Markdown 格式（加粗、列表、表格等）来增强可读性。

要求：
- 像一个懂技术的朋友在跟你聊天，口语化但专业
- 先介绍这个项目是干什么的（1-2句）
- 然后评价它的**健康状态**：说说活跃度怎么样、维护质量如何、社区是否健康
- 再评价它的**新手友好度**：有没有 Good First Issue、文档是否完善、适不适合第一次贡献
- 接着说说**风险和注意事项**：有没有 License、是否归档、PR 处理是否及时
- 最后给一段**总结建议**：这个项目值不值得关注、适不适合投入时间贡献
- 不要用表格，用自然段落
- 每段之间用空行分隔
- 语言像朋友聊天，不要官方腔`

    const userMsg = JSON.stringify(ctx, null, 2)

    let content = ''
    await chatStream(systemPrompt, userMsg, (chunk) => {
      content += chunk
      setLlmSummary(content)
    }, 1024)

    if (!content) {
      setLlmSummary('LLM 不可用，请稍后重试')
    }
    setLlmLoading(false)
  }

  /** 翻译 README — 分块并行，流式输出，简单直白解释 */
  async function translateReadme(ownerOverride, repoOverride) {
    const parsed = ownerOverride && repoOverride
      ? { owner: ownerOverride, repo: repoOverride }
      : parseRepoUrl(url)

    if (!parsed) {
      setReadmeError('无法解析仓库地址')
      return
    }

    setTransLoading(true)
    setReadmeError('')
    setTranslated('')
    setReadmeRaw('')
    setQaMessages([])

    try {
      const { owner, repo } = parsed
      setTransProgress('正在获取 README...')
      const { content, name } = await fetchReadmeContent(owner, repo)
      setReadmeRaw(content)
      setReadmeName(name)

      // 预处理：清除 HTML 标签和 GitHub 徽章图片，避免翻译出乱码
      const cleaned = preprocessReadme(content)
      const chunks = splitMarkdownChunks(cleaned, 3000)
      setTransProgress(`正在并行解释 ${chunks.length} 个片段...`)

      const systemPrompt = `你是一个技术文档翻译官。请用最简单直白的中文解释以下 README 内容，让完全不懂技术的人也能看懂。
要求：
1. 保留所有 Markdown 格式（标题、代码块、链接、表格、列表、图片等）
2. 图片语法 ![...](...) 必须原样保留，不要翻译或修改
3. 代码块和命令保持原样不翻译
4. 链接 URL 保持原样，链接文字翻译成中文
5. 技术术语用通俗说法解释，比如 "dependency" 说成 "依赖包"，"API" 说成 "接口"
6. 不要逐字翻译，用你自己的话把意思说清楚
7. 安装步骤要解释每一步在干什么，不只是翻译命令
8. 只输出结果，不要加任何解释说明`

      // 并行翻译 + throttle 渲染：多个块同时流式，但 setTranslated 最多每 50ms 调一次，不闪
      const chunkResults = new Array(chunks.length).fill(null)
      const chunkStreaming = new Array(chunks.length).fill('')
      let pendingUpdate = false

      const assembleDisplay = () =>
        chunkResults.map((r, j) => (r !== null ? r : chunkStreaming[j] || '⏳')).join('\n\n')

      const throttledUpdate = () => {
        if (pendingUpdate) return
        pendingUpdate = true
        requestAnimationFrame(() => {
          setTranslated(assembleDisplay())
          pendingUpdate = false
        })
      }

      await Promise.all(
        chunks.map((chunk, i) =>
          (async () => {
            let content = ''
            await chatStream(
              systemPrompt,
              chunk,
              (c) => {
                content += c
                chunkStreaming[i] = content
                throttledUpdate()
              },
              2048
            )
            chunkResults[i] = content || chunk
            throttledUpdate()
          })()
        )
      )

      setTranslated(assembleDisplay())

      setTransProgress('')
    } catch (e) {
      setReadmeError(e.message || '翻译失败')
    } finally {
      setTransLoading(false)
    }
  }

  /** 交互问答 — 流式输出 */
  async function sendQuestion() {
    const q = qaInput.trim()
    if (!q || !readmeRaw || qaLoading) return
    setQaInput('')
    const newMsgs = [...qaMessages, { role: 'user', content: q }]
    setQaMessages(newMsgs)
    setQaLoading(true)

    const context = readmeRaw.slice(0, 6000)
    let reply = ''
    setQaMessages([...newMsgs, { role: 'assistant', content: '' }])

    await chatStream(
      `你是一个开源项目助手。根据以下 README 内容回答用户问题。用中文回答，简洁明了。\n\nREADME 内容：\n${context}`,
      q,
      (chunk) => {
        reply += chunk
        setQaMessages([...newMsgs, { role: 'assistant', content: reply }])
      },
      1024
    )

    if (!reply) {
      setQaMessages([...newMsgs, { role: 'assistant', content: '抱歉，暂时无法回答。' }])
    }
    setQaLoading(false)
    setTimeout(() => qaEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  return (
    <section className="section analysis-section-wide">
      <div className="section-inner section-inner-wide">
        {/* 描述区 */}
        <div className="analysis-intro" data-reveal>
          <div className="section-label">模块二</div>
          <h2>仓库分析中心</h2>
          <div className="analysis-empty-icon">🔍</div>
          <h3 className="analysis-empty-title">分析一个仓库，看看它适不适合你贡献</h3>
          <p className="analysis-empty-sub">
            输入 GitHub 仓库地址，自动采集多维度指标，生成项目健康度报告，帮你判断是否值得投入时间。
          </p>
        </div>

        <div className="analysis-input" data-reveal>
          <input
            className="search-box-input"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (activeTab === 'translate' ? translateReadme() : analyze())}
            placeholder="owner/repo 或 https://github.com/owner/repo"
          />
          <button className="search-box-btn" onClick={activeTab === 'translate' ? () => translateReadme() : () => analyze()} disabled={loading || transLoading}>
            {loading ? '正在采集仓库数据' : transLoading ? '翻译中...' : activeTab === 'translate' ? '翻译 README' : '分析'}
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="readme-tabs" data-reveal>
          <button className={`readme-tab ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => setActiveTab('analysis')}>
            📊 健康分析
          </button>
          <button className={`readme-tab ${activeTab === 'translate' ? 'active' : ''}`} onClick={() => setActiveTab('translate')}>
            🌐 README 翻译
          </button>
        </div>

        {activeTab === 'analysis' && (
          <>
            {!report && !loading && !error && (
              <div className="analysis-empty">
                {/* 分析维度说明区 */}
                <div className="analysis-dimensions">
                  <div className="analysis-dimensions-title">分析会看哪些维度</div>
                  <div className="analysis-dimension-grid">
                    <div className="analysis-dimension-card-wrapper">
                      <div className="analysis-dimension-card">
                        <span className="analysis-dimension-icon">⚡</span>
                        <div>
                          <div className="analysis-dimension-name">活跃度</div>
                          <div className="analysis-dimension-desc">Commit、Push、Issue、PR 的近期活动情况</div>
                        </div>
                      </div>
                      <div className="dimension-tooltip">
                        <div className="dimension-tooltip-title">详细说明</div>
                        <div className="dimension-tooltip-body">分析仓库近期的 Commit 频率、Issue 响应速度、PR 处理效率。活跃的仓库通常有日均 ≥1 次 Commit，Issue 在 7 天内得到回复，PR 在 14 天内被合并或关闭。</div>
                      </div>
                    </div>
                    <div className="analysis-dimension-card-wrapper">
                      <div className="analysis-dimension-card">
                        <span className="analysis-dimension-icon">🌱</span>
                        <div>
                          <div className="analysis-dimension-name">新手友好度</div>
                          <div className="analysis-dimension-desc">Good First Issue、CONTRIBUTING、Issue 模板等</div>
                        </div>
                      </div>
                      <div className="dimension-tooltip">
                        <div className="dimension-tooltip-title">详细说明</div>
                        <div className="dimension-tooltip-body">检查仓库是否有 Good First Issue 标签、CONTRIBUTING.md 文档、Issue/PR 模板。新手友好度高的仓库会降低贡献门槛，帮助初学者快速上手。</div>
                      </div>
                    </div>
                    <div className="analysis-dimension-card-wrapper">
                      <div className="analysis-dimension-card">
                        <span className="analysis-dimension-icon">🔧</span>
                        <div>
                          <div className="analysis-dimension-name">维护质量</div>
                          <div className="analysis-dimension-desc">PR 处理速度、Merge 率、Issue 关闭时间</div>
                        </div>
                      </div>
                      <div className="dimension-tooltip">
                        <div className="dimension-tooltip-title">详细说明</div>
                        <div className="dimension-tooltip-body">评估 PR 的处理速度（中位数合并时间）、Merge 率（合并/关闭比例）、Issue 关闭率。高质量的仓库会在 7-14 天内处理 PR，Merge 率{'>'} 60%。</div>
                      </div>
                    </div>
                    <div className="analysis-dimension-card-wrapper">
                      <div className="analysis-dimension-card">
                        <span className="analysis-dimension-icon">📚</span>
                        <div>
                          <div className="analysis-dimension-name">文档生态</div>
                          <div className="analysis-dimension-desc">README、行为准则、Topics、License 等</div>
                        </div>
                      </div>
                      <div className="dimension-tooltip">
                        <div className="dimension-tooltip-title">详细说明</div>
                        <div className="dimension-tooltip-body">检查 README 完整性、Code of Conduct 行为准则、Topics 标签、License 许可协议。文档完善的仓库更容易被理解和贡献。</div>
                      </div>
                    </div>
                    <div className="analysis-dimension-card-wrapper">
                      <div className="analysis-dimension-card">
                        <span className="analysis-dimension-icon">🛡️</span>
                        <div>
                          <div className="analysis-dimension-name">风险评估</div>
                          <div className="analysis-dimension-desc">归档、无协议、单贡献者、活跃度停滞等</div>
                        </div>
                      </div>
                      <div className="dimension-tooltip">
                        <div className="dimension-tooltip-title">详细说明</div>
                        <div className="dimension-tooltip-body">综合评估仓库的 License 合规性、长期活跃趋势、安全风险（如依赖过时、未修复的安全 Issue）。帮助你判断是否值得投入时间贡献。</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 交互式入口：3 个场景按钮 */}
                <div className="analysis-scenarios">
                  <div className="analysis-scenarios-title">从哪里开始？</div>
                  <div className="analysis-scenario-grid">
                    <button
                      className="analysis-scenario-btn"
                      onClick={() => {
                        const v = window.prompt('请输入你 Fork 过的仓库（owner/repo）')
                        if (v) { setUrl(v); setTimeout(() => analyze(), 50) }
                      }}
                    >
                      <span className="analysis-scenario-icon">🍴</span>
                      <span className="analysis-scenario-name">分析我 Fork 过的仓库</span>
                      <span className="analysis-scenario-hint">输入 owner/repo 即可</span>
                    </button>
                    <button
                      className="analysis-scenario-btn"
                      onClick={() => {
                        const v = window.prompt('请输入你想贡献的仓库（owner/repo）')
                        if (v) { setUrl(v); setTimeout(() => analyze(), 50) }
                      }}
                    >
                      <span className="analysis-scenario-icon">💡</span>
                      <span className="analysis-scenario-name">分析我想贡献的仓库</span>
                      <span className="analysis-scenario-hint">输入 owner/repo 即可</span>
                    </button>
                    <button
                      className="analysis-scenario-btn"
                      onClick={() => {
                        window.alert('请先到「搜索」页搜索感兴趣的仓库，搜索结果中可一键跳转到分析页。')
                      }}
                    >
                      <span className="analysis-scenario-icon">🔎</span>
                      <span className="analysis-scenario-name">从搜索结果跳转分析</span>
                      <span className="analysis-scenario-hint">先去搜索页搜仓库</span>
                    </button>
                  </div>
                </div>

                {/* 示例仓库区 */}
                <div className="analysis-empty-examples">
                  <div className="analysis-empty-examples-title">
                    或者，先试试这些对新手友好的中型仓库
                  </div>
                  <div className="analysis-empty-examples-grid">
                    <button className="analysis-example-card" onClick={() => { setUrl('sindresorhus/awesome'); setTimeout(() => analyze(), 50) }}>
                      <span className="analysis-example-icon">📋</span>
                      <span className="analysis-example-label">sindresorhus/awesome</span>
                      <span className="analysis-example-desc">awesome 列表</span>
                    </button>
                    <button className="analysis-example-card" onClick={() => { setUrl('firstcontributions/first-contributions'); setTimeout(() => analyze(), 50) }}>
                      <span className="analysis-example-icon">🎓</span>
                      <span className="analysis-example-label">firstcontributions/first-contributions</span>
                      <span className="analysis-example-desc">新手贡献教程</span>
                    </button>
                    <button className="analysis-example-card" onClick={() => { setUrl('freeCodeCamp/how-to-contribute-to-open-source'); setTimeout(() => analyze(), 50) }}>
                      <span className="analysis-example-icon">📖</span>
                      <span className="analysis-example-label">freeCodeCamp/how-to-contribute-to-open-source</span>
                      <span className="analysis-example-desc">贡献指南</span>
                    </button>
                    <button className="analysis-example-card" onClick={() => { setUrl('Hacktoberfest/Hacktoberfest'); setTimeout(() => analyze(), 50) }}>
                      <span className="analysis-example-icon">🎃</span>
                      <span className="analysis-example-label">Hacktoberfest/Hacktoberfest</span>
                      <span className="analysis-example-desc">年度活动</span>
                    </button>
                    <button className="analysis-example-card" onClick={() => { setUrl('awesome-selfhosted/awesome-selfhosted'); setTimeout(() => analyze(), 50) }}>
                      <span className="analysis-example-icon">🖥️</span>
                      <span className="analysis-example-label">awesome-selfhosted/awesome-selfhosted</span>
                      <span className="analysis-example-desc">自托管软件列表</span>
                    </button>
                    <button className="analysis-example-card" onClick={() => { setUrl('TheAlgorithms/Python'); setTimeout(() => analyze(), 50) }}>
                      <span className="analysis-example-icon">🐍</span>
                      <span className="analysis-example-label">TheAlgorithms/Python</span>
                      <span className="analysis-example-desc">Python 算法集合</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {urlHint && <div className="search-status" style={{ color: 'var(--muted)' }}>{urlHint}</div>}
            {error && <div className="search-status error">{error}</div>}

            {report && <ReportView report={report} llmSummary={llmSummary} llmLoading={llmLoading} setUrl={setUrl} setReport={setReport} setLlmSummary={setLlmSummary} />}
          </>
        )}

        {/* README 翻译 Tab */}
        {activeTab === 'translate' && (
          <div className="readme-translate-section">
            {readmeError && <div className="search-status error">{readmeError}</div>}

            {transProgress && (
              <div className="readme-progress">
                <div className="readme-progress-spinner" />
                <span>{transProgress}</span>
              </div>
            )}

            {!translated && !transLoading && !readmeError && (
              <div className="readme-empty">
                <div className="readme-empty-icon">🌐</div>
                <h3>一键翻译 README 为中文</h3>
                <p>输入仓库地址，点击"翻译 README"，AI 自动翻译并保留 Markdown 格式。翻译完成后还可以向 AI 提问了解更多。</p>
              </div>
            )}

            {translated && (
              <>
                <div className="readme-result-header">
                  <span>📖 {readmeName || 'README'} — 中文翻译</span>
                  <button className="llm-redo" onClick={translateReadme} disabled={transLoading}>重新翻译</button>
                </div>
                <div className="readme-content markdown-body">{renderMarkdown(translated)}</div>

                {/* 交互问答区 */}
                <div className="readme-qa-section">
                  <div className="readme-qa-title">💬 向 AI 提问</div>
                  <p className="readme-qa-hint">基于 README 内容，你可以问任何关于这个项目的问题</p>
                  <div className="readme-qa-messages">
                    {qaMessages.length === 0 && (
                      <div className="readme-qa-empty">试试问：这个项目怎么安装？/ 它主要用来做什么？/ 适合新手吗？</div>
                    )}
                    {qaMessages.map((msg, i) => (
                      <div key={i} className={`readme-qa-msg ${msg.role}`}>
                        <span className="readme-qa-role">{msg.role === 'user' ? '🧑' : '🤖'}</span>
                        <div className="readme-qa-text markdown-body">{renderMarkdown(msg.content)}</div>
                      </div>
                    ))}
                    <div ref={qaEndRef} />
                  </div>
                  <div className="readme-qa-input-row">
                    <input
                      className="readme-qa-input"
                      value={qaInput}
                      onChange={e => setQaInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendQuestion()}
                      placeholder="输入你的问题..."
                      disabled={qaLoading}
                    />
                    <button className="readme-qa-send" onClick={sendQuestion} disabled={qaLoading || !qaInput.trim()}>
                      发送
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** 预处理 README：清除 HTML 标签和编码问题，保留 Markdown 图片 */
function preprocessReadme(md) {
  let cleaned = md
  // 1. 移除 HTML 注释
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')
  // 2. 移除 <img> 标签，替换为 [图片]
  cleaned = cleaned.replace(/<img[^>]*\/?>/gi, '[图片]')
  // 3. 移除 <a> 标签但保留链接文字
  cleaned = cleaned.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
  // 4. 移除其他 HTML 标签但保留内容
  cleaned = cleaned.replace(/<\/?(div|span|p|br|hr|table|tr|td|th|thead|tbody|col|colgroup|caption|style|script|iframe|svg|video|audio|source|canvas|figure|figcaption|details|summary|section|article|header|footer|nav|aside|main|form|input|button|select|option|textarea|label|fieldset|legend)[^>]*\/?>/gi, '')
  cleaned = cleaned.replace(/<\/?(div|span|p|br|hr|table|tr|td|th|thead|tbody|col|colgroup|caption|style|script|iframe|svg|video|audio|source|canvas|figure|figcaption|details|summary|section|article|header|footer|nav|aside|main|form|input|button|select|option|textarea|label|fieldset|legend)[^>]*>/gi, '')
  // 5. 保留 Markdown 图片语法 ![...](...)，只移除裸 URL 的 GitHub 徽章（如 !https://...）
  cleaned = cleaned.replace(/!https?:\/\/\S+/g, '')
  // 6. 修复编码乱码：替换常见的 mojibake 模式
  cleaned = cleaned.replace(/Ã¢ÂÂ/g, "'")
  cleaned = cleaned.replace(/Ã¢ÂÂ/g, '"')
  cleaned = cleaned.replace(/Ã¢ÂÂ/g, '"')
  cleaned = cleaned.replace(/Ã¢ÂÂ/g, '—')
  cleaned = cleaned.replace(/Ã¢ÂÂ/g, '–')
  cleaned = cleaned.replace(/ÃÂ/g, '')
  cleaned = cleaned.replace(/â/g, '')
  cleaned = cleaned.replace(/Â/g, '')
  // 7. 清理多余空行（超过 3 个连续空行压缩为 2 个）
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n')
  return cleaned
}

/** 将 Markdown 按 ## 标题分块，每块不超过 maxChars */
function splitMarkdownChunks(md, maxChars = 3000) {
  // 按 ## 标题分割
  const sections = md.split(/(?=^## )/m)
  const chunks = []
  let current = ''

  for (const sec of sections) {
    if (current && (current.length + sec.length > maxChars)) {
      chunks.push(current.trim())
      current = sec
    } else {
      current += (current ? '\n\n' : '') + sec
    }
  }
  if (current.trim()) chunks.push(current.trim())

  // 如果某块仍然超过 maxChars，强制按字符截断
  const result = []
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      result.push(chunk)
    } else {
      // 在段落边界截断
      let remaining = chunk
      while (remaining.length > maxChars) {
        const cutPoint = remaining.lastIndexOf('\n\n', maxChars)
        if (cutPoint > maxChars / 2) {
          result.push(remaining.slice(0, cutPoint).trim())
          remaining = remaining.slice(cutPoint + 2)
        } else {
          result.push(remaining.slice(0, maxChars))
          remaining = remaining.slice(maxChars)
        }
      }
      if (remaining.trim()) result.push(remaining.trim())
    }
  }
  return result.length > 0 ? result : [md]
}

/** 分析报告展示 — 6 块布局 */
function ReportView({ report, llmSummary, llmLoading, setUrl, setReport, setLlmSummary }) {
  const { info, liveness, scores, recommendations } = report
  const topics = info.topics || []
  const navigate = useNavigate()

  return (
    <div className="analysis-report">
      {/* 块 1：仓库概览（头部 + Topics + 健康度总览） — 全宽 */}
      <section className="analysis-block">
        <RepoHeader info={info} liveness={liveness} scores={scores} />
        {topics.length > 0 && (
          <div className="analysis-topics">
            {topics.map(t => <span key={t} className="result-label analysis-topic">{t}</span>)}
          </div>
        )}
        <HealthOverview scores={scores} liveness={liveness} />
      </section>

      {/* 块 2 + 块 3 并排 */}
      <div className="analysis-row">
        {/* 块 2：活跃度分析（Git 活动 vs 仓库/社区更新 分项展示） */}
        <section className="analysis-block">
          <ActivityAnalysis report={report} liveness={liveness} />
        </section>

        {/* 块 3：社区与维护（社区协作 + 维护质量 + 新手友好） */}
        <section className="analysis-block">
          <CommunityAnalysis report={report} />
          <MaintenanceAnalysis report={report} />
          <BeginnerAnalysis report={report} />
        </section>
      </div>

      {/* 块 4 + 块 5 并排 */}
      <div className="analysis-row">
        {/* 块 4：文档与生态（文档 + 语言 + 功能开关） */}
        <section className="analysis-block">
          <DocEcosystemAnalysis report={report} />
          {report.languages && Object.keys(report.languages).length > 0 && (
            <LanguageBar languages={report.languages} />
          )}
          <FeatureFlags info={info} />
        </section>

        {/* 块 5：风险与建议（风险评估 + 改进建议） */}
        <section className="analysis-block">
          <RiskAssessment report={report} liveness={liveness} />
          {recommendations.length > 0 && (
            <Recommendations items={recommendations} />
          )}
        </section>
      </div>

      {/* 块 6：AI 项目画像 — 全宽，流式输出 */}
      <section className="analysis-block">
        <div className="llm-section">
          {llmLoading && !llmSummary && <div className="search-status">AI 正在分析项目画像...</div>}
          {llmSummary && (
            <div className="llm-result">
              <div className="llm-result-header">
                <span>🧠 AI 项目画像</span>
                {llmLoading && <span className="llm-typing-indicator">输入中...</span>}
              </div>
              <div className="llm-text markdown-body">{renderMarkdown(llmSummary)}</div>
            </div>
          )}
          {!llmSummary && !llmLoading && (
            <div className="llm-text llm-text-empty">AI 项目画像生成中，请稍候...</div>
          )}
        </div>
      </section>

      {/* CTA 区域 */}
      <section className="analysis-block analysis-cta-block">
        <div className="analysis-cta">
          <div className="analysis-cta-title">下一步做什么？</div>
          <div className="analysis-cta-desc">分析完成，选择一个方向继续</div>
          <div className="analysis-cta-actions">
            <button className="analysis-cta-btn analysis-cta-primary" onClick={() => window.open(`https://github.com/${report.info.fullName}`, '_blank')}>
              在 GitHub 上查看 →
            </button>
            <button className="analysis-cta-btn" onClick={() => navigate(`/contribute?url=${encodeURIComponent(report.info.fullName)}`)}>
              去贡献这个仓库 🤝
            </button>
            <button className="analysis-cta-btn" onClick={() => { setUrl(''); setReport(null); setLlmSummary('') }}>
              换一个仓库分析 🔄
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

/** 仓库头部卡片 */
function RepoHeader({ info, liveness, scores }) {
  const badges = []
  if (info.archived) badges.push({ text: '已归档', cls: 'badge-archived' })
  if (info.disabled) badges.push({ text: '已禁用', cls: 'badge-disabled' })
  if (info.isFork) badges.push({ text: 'Fork', cls: 'badge-fork' })
  if (info.isTemplate) badges.push({ text: '模板', cls: 'badge-template' })

  return (
    <div className="repo-header-card">
      <div className="repo-header-main">
        <div className="repo-header-title">
          <h3>{info.fullName}</h3>
          {badges.map(b => <span key={b.text} className={`repo-badge ${b.cls}`}>{b.text}</span>)}
        </div>
        {info.desc && <p className="repo-header-desc">{info.desc}</p>}
        {info.parent && (
          <p className="repo-header-parent">forked from <a href={info.parent.url} target="_blank" rel="noreferrer">{info.parent.name}</a></p>
        )}
        <div className="repo-header-meta">
          <span>📦 {formatNum(info.stars)} stars</span>
          <span>🍴 {formatNum(info.forks)} forks</span>
          {info.watchers != null && <span>👁 {formatNum(info.watchers)} watchers</span>}
          {info.networkCount != null && <span>🌐 {formatNum(info.networkCount)} network</span>}
          <span>🌿 {info.defaultBranch}</span>
          {info.license && info.license !== '无' && <span>📜 {info.license}</span>}
        </div>
      </div>
      <div className="repo-header-score">
        <div className="health-score-num" style={{ color: scoreColor(scores.total) }}>{scores.total}</div>
        <div className="health-score-label">健康度</div>
        <div className={`liveness-badge liveness-${liveness.status}`}>{liveness.level}</div>
      </div>
    </div>
  )
}

/** 健康度总览 */
function HealthOverview({ scores, liveness }) {
  return (
    <div className="health-overview">
      <div className="health-bars">
        <HealthBar label="活跃度" score={scores.activity} max={20} />
        <HealthBar label="贡献者" score={scores.contributors} max={15} />
        <HealthBar label="新手友好" score={scores.beginner} max={20} />
        <HealthBar label="维护质量" score={scores.maintenance} max={20} />
        <HealthBar label="文档" score={scores.docs} max={15} />
        <HealthBar label="生态" score={scores.ecosystem} max={10} />
      </div>
    </div>
  )
}

/** 基础指标网格 */
function MetricGrid({ report }) {
  const { info, contributorCount, openPRCount, commits30d, branchCount, issueCloseDays, prDays, prMergeRate } = report
  const trueIssues = info.trueOpenIssues ?? info.openIssues
  const items = [
    { label: 'Stars', value: formatNum(info.stars) },
    { label: 'Forks', value: formatNum(info.forks) },
    { label: 'Watchers', value: formatNum(info.watchers) },
    { label: 'Open Issues', value: trueIssues ?? '—' },
    { label: 'Open PRs', value: openPRCount },
    { label: '贡献者', value: contributorCount },
    { label: '30 天提交', value: commits30d },
    { label: '分支数', value: branchCount || '—' },
    { label: '主语言', value: info.language || '未知' },
    { label: '协议', value: info.license || '无' },
    { label: '仓库大小', value: formatSize(info.size) },
    { label: 'Issue 中位关闭', value: issueCloseDays !== null ? `${issueCloseDays} 天` : '—' },
    { label: 'PR 中位处理', value: prDays !== null ? `${prDays} 天` : '—' },
    { label: 'PR Merge 率', value: prMergeRate !== null ? `${prMergeRate}%` : '—' },
  ]
  return (
    <div className="metric-grid">
      {items.map(it => <MetricCard key={it.label} label={it.label} value={it.value} />)}
    </div>
  )
}

/** 活跃度分析 — 分项展示 Git 活动 vs 仓库/社区更新 */
function ActivityAnalysis({ report, liveness }) {
  const {
    daysSinceLastCommit, daysSincePush, daysSinceUpdated, daysSinceCommunity,
    lastCommitAt, lastPushAt, lastUpdatedAt, lastCommunityAt,
    repoAgeDays, commits30d, info,
  } = report

  // Git 活动组（代码层面）
  const gitItems = [
    {
      label: '最后 Commit',
      value: daysSinceLastCommit !== null ? humanizeDays(daysSinceLastCommit) : '未知',
      time: lastCommitAt ? new Date(lastCommitAt).toLocaleString('zh-CN') : '',
      days: daysSinceLastCommit,
    },
    {
      label: '最后 Push',
      value: daysSincePush !== null ? humanizeDays(daysSincePush) : '未知',
      time: lastPushAt ? new Date(lastPushAt).toLocaleString('zh-CN') : '',
      days: daysSincePush,
    },
    {
      label: '30 天提交',
      value: `${commits30d} 次`,
      days: commits30d === 0 ? 9999 : -commits30d,
    },
  ]

  // 仓库/社区更新组（Issue/PR/元数据等）
  const communityItems = [
    {
      label: '仓库更新',
      value: daysSinceUpdated !== null ? humanizeDays(daysSinceUpdated) : '未知',
      time: lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString('zh-CN') : '',
      days: daysSinceUpdated,
      hint: '含 Issue/PR/元数据变更',
    },
    {
      label: '社区活动',
      value: daysSinceCommunity !== null ? humanizeDays(daysSinceCommunity) : '未知',
      time: lastCommunityAt ? new Date(lastCommunityAt).toLocaleString('zh-CN') : '',
      days: daysSinceCommunity,
      hint: '最近 Issue/PR 评论或关闭',
    },
  ]

  const otherItems = [
    { label: '仓库年龄', value: repoAgeDays !== null ? humanizeDays(repoAgeDays) : '未知' },
    { label: '创建时间', value: info.createdAt ? new Date(info.createdAt).toLocaleDateString('zh-CN') : '未知' },
  ]

  return (
    <AnalysisSection title="活跃度分析" icon="⚡">
      {/* 综合等级 + 依据说明 */}
      <div className="liveness-summary">
        <div className="liveness-summary-level">
          <span className={`liveness-badge liveness-${liveness.status}`}>{liveness.level}</span>
          <span className="liveness-summary-basis">
            综合判定依据：<strong>{liveness.basis}</strong>
            {liveness.days !== null && <span>（{humanizeDays(liveness.days)}）</span>}
          </span>
        </div>
        <p className="liveness-summary-note">
          综合考虑 Commit、Push、仓库更新、社区活动四个维度，取最新的作为活跃度判断依据，避免仅凭默认分支 commit 时间误判活跃仓库。
        </p>
      </div>

      {/* Git 活动 */}
      <div className="activity-group">
        <div className="activity-group-title">🔧 Git 活动（代码层面）</div>
        <div className="kv-grid">
          {gitItems.map(it => (
            <div key={it.label} className="kv-item">
              <div className="kv-label">{it.label}</div>
              <div className="kv-value" style={{ color: activityColor(it.days) }}>{it.value}</div>
              {it.time && <div className="kv-hint">{it.time}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 仓库/社区更新 */}
      <div className="activity-group">
        <div className="activity-group-title">💬 仓库/社区更新（Issue/PR/元数据）</div>
        <div className="kv-grid">
          {communityItems.map(it => (
            <div key={it.label} className="kv-item">
              <div className="kv-label">{it.label}</div>
              <div className="kv-value" style={{ color: activityColor(it.days) }}>{it.value}</div>
              {it.time && <div className="kv-hint">{it.time}</div>}
              {it.hint && <div className="kv-hint">{it.hint}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 其他 */}
      <div className="activity-group">
        <div className="kv-grid">
          {otherItems.map(it => (
            <div key={it.label} className="kv-item">
              <div className="kv-label">{it.label}</div>
              <div className="kv-value">{it.value}</div>
            </div>
          ))}
        </div>
      </div>

      {liveness.days !== null && liveness.days > 180 && (
        <div className="liveness-warning">
          <span className="warning-icon">⚠</span>
          <span>该项目综合活跃度判定为「{liveness.level}」（依据：{liveness.basis}，{humanizeDays(liveness.days)}）。注意：默认分支 commit 很旧不代表仓库死亡——Issue/PR 仍可能有活动。</span>
        </div>
      )}
    </AnalysisSection>
  )
}

/** 活跃度颜色：天数越小越绿 */
function activityColor(days) {
  if (days === null || days === undefined) return 'var(--ink)'
  if (days < 0) return 'var(--green)' // 负数表示计数（如 commits30d）
  if (days <= 7) return 'var(--green)'
  if (days <= 30) return 'var(--green)'
  if (days <= 90) return 'var(--amber)'
  if (days <= 180) return 'var(--amber)'
  return 'var(--rose)'
}

/** 社区与协作 */
function CommunityAnalysis({ report }) {
  const { contributorCount, openPRCount, info, community, hasReleases, latestRelease, latestReleaseDate } = report
  const trueIssues = info.trueOpenIssues ?? info.openIssues
  const items = [
    { label: '贡献者数', value: contributorCount, hint: contributorCount >= 20 ? '社区活跃' : contributorCount >= 5 ? '有一定社区' : '少数维护者' },
    { label: 'Open Issues', value: trueIssues ?? '—', hint: '不含 PR 的真实 Issue 数' },
    { label: 'Open PRs', value: openPRCount },
    { label: '社区健康度', value: community ? `${community.healthPercentage}%` : '—' },
    { label: '最新 Release', value: latestRelease || (hasReleases ? '有' : '无'), hint: latestReleaseDate ? new Date(latestReleaseDate).toLocaleDateString('zh-CN') : '' },
    { label: 'Network 数', value: formatNum(info.networkCount), hint: '含 fork 的 fork' },
  ]
  return (
    <AnalysisSection title="社区与协作" icon="👥">
      <div className="kv-grid">
        {items.map(it => (
          <div key={it.label} className="kv-item">
            <div className="kv-label">{it.label}</div>
            <div className="kv-value">{it.value}</div>
            {it.hint && <div className="kv-hint">{it.hint}</div>}
          </div>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 新手友好度 */
function BeginnerAnalysis({ report }) {
  const { gfiCount, helpWantedCount, hasContributing, hasReadme, community } = report
  const items = [
    { label: 'Good First Issue', value: gfiCount, ok: gfiCount > 0 },
    { label: 'Help Wanted', value: helpWantedCount, ok: helpWantedCount > 0 },
    { label: 'README.md', value: hasReadme ? '✅ 有' : '❌ 无', ok: hasReadme },
    { label: 'CONTRIBUTING.md', value: hasContributing ? '✅ 有' : '❌ 无', ok: hasContributing },
    { label: '行为准则', value: community?.hasCodeOfConduct ? '✅ 有' : '❌ 无', ok: !!community?.hasCodeOfConduct },
    { label: 'Issue 模板', value: community?.hasIssueTemplate ? '✅ 有' : '❌ 无', ok: !!community?.hasIssueTemplate },
    { label: 'PR 模板', value: community?.hasPullRequestTemplate ? '✅ 有' : '❌ 无', ok: !!community?.hasPullRequestTemplate },
  ]
  return (
    <AnalysisSection title="新手友好度" icon="🌱">
      <div className="kv-grid">
        {items.map(it => (
          <div key={it.label} className="kv-item">
            <div className="kv-label">{it.label}</div>
            <div className="kv-value">{it.value}</div>
          </div>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 维护质量 */
function MaintenanceAnalysis({ report }) {
  const { prDays, prMergeRate, openPRCount, issueCloseDays, info } = report
  // 总 open 数（含 Issue + PR），用于计算占比，确保结果 0-100%
  const totalOpen = info.openIssues || 0
  const prRatio = totalOpen > 0 && openPRCount !== null ? Math.round((openPRCount / totalOpen) * 100) : null
  const items = [
    { label: 'PR 中位处理时间', value: prDays !== null ? `${prDays} 天` : '无合并 PR', ok: prDays !== null && prDays <= 7 },
    { label: 'PR Merge 率', value: prMergeRate !== null ? `${prMergeRate}%` : '—', ok: prMergeRate !== null && prMergeRate >= 50 },
    { label: 'Issue 中位关闭时间', value: issueCloseDays !== null ? `${issueCloseDays} 天` : '无关闭 Issue', ok: issueCloseDays !== null && issueCloseDays <= 7 },
    { label: 'Open PR 占比', value: prRatio !== null ? `${prRatio}%` : '—', hint: `Open PR / 总 Open 数（${totalOpen}）`, ok: prRatio !== null && prRatio < 50 },
  ]
  return (
    <AnalysisSection title="维护质量" icon="🔧">
      <div className="kv-grid">
        {items.map(it => (
          <div key={it.label} className="kv-item">
            <div className="kv-label">{it.label}</div>
            <div className="kv-value" style={{ color: it.ok ? 'var(--green)' : 'var(--ink)' }}>{it.value}</div>
          </div>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 文档与生态 */
function DocEcosystemAnalysis({ report }) {
  const { info, hasReadme, hasContributing, community } = report
  const items = [
    { label: 'README', value: hasReadme ? '✅' : '❌' },
    { label: 'CONTRIBUTING', value: hasContributing ? '✅' : '❌' },
    { label: '行为准则', value: community?.hasCodeOfConduct ? '✅' : '❌' },
    { label: 'Issue 模板', value: community?.hasIssueTemplate ? '✅' : '❌' },
    { label: 'PR 模板', value: community?.hasPullRequestTemplate ? '✅' : '❌' },
    { label: 'Topics', value: info.topics?.length || 0 },
    { label: 'Homepage', value: info.homepage ? '✅' : '❌' },
    { label: 'License', value: info.license && info.license !== '无' ? '✅' : '❌' },
  ]
  return (
    <AnalysisSection title="文档与生态" icon="📚">
      <div className="kv-grid">
        {items.map(it => (
          <div key={it.label} className="kv-item">
            <div className="kv-label">{it.label}</div>
            <div className="kv-value">{it.value}</div>
          </div>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 功能开关 */
function FeatureFlags({ info }) {
  const flags = [
    { label: 'Issues', on: info.hasIssues },
    { label: 'Wiki', on: info.hasWiki },
    { label: 'Pages', on: info.hasPages },
    { label: 'Projects', on: info.hasProjects },
    { label: 'Discussions', on: info.hasDiscussions },
    { label: '允许 Fork', on: info.allowForking },
  ]
  return (
    <AnalysisSection title="仓库功能" icon="⚙️">
      <div className="flag-row">
        {flags.map(f => (
          <span key={f.label} className={`flag-chip ${f.on ? 'on' : 'off'}`}>
            {f.on ? '✅' : '⚫'} {f.label}
          </span>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 风险评估 — 基于综合活跃度判断 */
function RiskAssessment({ report, liveness }) {
  const { info } = report
  const risks = []
  if (info.archived) {
    risks.push({ level: 'high', text: '仓库已归档，不再维护，不建议用于生产' })
  }
  if (info.disabled) {
    risks.push({ level: 'high', text: '仓库已被禁用（DMCA 或违规）' })
  }
  if (!info.license || info.license === '无') {
    risks.push({ level: 'high', text: '无开源协议，默认保留所有权利，不可自由使用' })
  }
  // 活跃度风险：基于综合判断（非仅 commit）
  if (liveness.days !== null && liveness.days > 365 && !info.archived) {
    risks.push({ level: 'high', text: `综合活跃度判定为「疑似废弃」（依据：${liveness.basis}，${humanizeDays(liveness.days)}）—— Commit/Push/仓库更新/社区活动四项均长期无活动` })
  } else if (liveness.days !== null && liveness.days > 180 && !info.archived) {
    risks.push({ level: 'medium', text: `综合活跃度「${liveness.level}」（依据：${liveness.basis}，${humanizeDays(liveness.days)}）—— 四项活动维度均显示停滞` })
  }
  // 仅当 30 天提交为 0 且社区活动也停滞时才提示
  if (report.commits30d === 0 && (report.daysSinceCommunity === null || report.daysSinceCommunity > 30)) {
    risks.push({ level: 'low', text: '近 30 天无 commit 且社区活动停滞' })
  }
  if (info.isFork) {
    risks.push({ level: 'low', text: '这是 Fork 仓库，建议查看上游原仓库' })
  }
  if (report.contributorCount === 1) {
    risks.push({ level: 'low', text: '仅 1 位贡献者，Bus Factor 风险' })
  }

  if (risks.length === 0) {
    return (
      <AnalysisSection title="风险评估" icon="🛡️">
        <div className="risk-empty">未发现明显风险，项目状态健康 ✅</div>
      </AnalysisSection>
    )
  }
  return (
    <AnalysisSection title="风险评估" icon="🛡️">
      <div className="risk-list">
        {risks.map((r, i) => (
          <div key={i} className={`risk-item risk-${r.level}`}>
            <span className="risk-level">{r.level === 'high' ? '高危' : r.level === 'medium' ? '中危' : '低危'}</span>
            <span>{r.text}</span>
          </div>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 改进建议 */
function Recommendations({ items }) {
  return (
    <AnalysisSection title="改进建议" icon="💡">
      <div className="reco-list">
        {items.map((r, i) => (
          <div key={i} className="reco-item">
            <span className="reco-icon">{r.icon}</span>
            <div>
              <div className="reco-title">{r.title}</div>
              <div className="reco-desc">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </AnalysisSection>
  )
}

/** 语言分布条 */
function LanguageBar({ languages }) {
  const total = Object.values(languages).reduce((s, v) => s + v, 0)
  const entries = Object.entries(languages).sort(([, a], [, b]) => b - a).slice(0, 8)
  return (
    <AnalysisSection title="语言分布" icon="🎨">
      <div className="languages-bar">
        {entries.map(([lang, bytes]) => {
          const pct = Math.round((bytes / total) * 100)
          return (
            <div key={lang} className="lang-item" style={{ flex: `${Math.max(pct, 2)}%` }} title={`${lang}: ${pct}%`}>
              <div className="lang-fill" style={{ background: langColor(lang) }} />
              <span className="lang-label">{lang} {pct}%</span>
            </div>
          )
        })}
      </div>
    </AnalysisSection>
  )
}

/** 通用分析区块 */
function AnalysisSection({ title, icon, children }) {
  return (
    <div className="analysis-section">
      <div className="analysis-section-header">
        <span className="analysis-section-icon">{icon}</span>
        <h4>{title}</h4>
      </div>
      <div className="analysis-section-body">{children}</div>
    </div>
  )
}

function HealthBar({ label, score, max }) {
  const pct = Math.round((score / max) * 100)
  return (
    <div className="health-bar">
      <div className="health-bar-label">{label}</div>
      <div className="health-bar-track">
        <div className="health-bar-fill" style={{ width: `${pct}%`, background: scoreColor(score, max) }} />
      </div>
      <div className="health-bar-score">{score}/{max}</div>
    </div>
  )
}

function MetricCard({ label, value }) {
  return (
    <div className="metric-card">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

/** 生成改进建议 */
function buildRecommendations(data, liveness, scores) {
  const recos = []
  const { info } = data

  if (info.archived) {
    recos.push({ icon: '📦', title: '仓库已归档', desc: '该项目已停止维护，如需使用请寻找活跃的 Fork 或替代方案' })
  }
  if (!info.license || info.license === '无') {
    recos.push({ icon: '📜', title: '缺少开源协议', desc: '建议添加 LICENSE 文件，明确使用条款，否则默认保留所有权利' })
  }
  if (!data.hasReadme) {
    recos.push({ icon: '📖', title: '缺少 README', desc: 'README 是项目门面，建议添加项目介绍、安装和使用说明' })
  }
  if (!data.hasContributing) {
    recos.push({ icon: '🤝', title: '缺少 CONTRIBUTING.md', desc: '建议添加贡献指南，帮助新人了解如何参与' })
  }
  if (data.gfiCount === 0 && data.helpWantedCount === 0) {
    recos.push({ icon: '🌱', title: '无新手友好标签', desc: '建议添加 good first issue / help wanted 标签吸引贡献者' })
  }
  if (liveness.days !== null && liveness.days > 90 && !info.archived) {
    recos.push({ icon: '💤', title: '活跃度下降', desc: `综合活跃度「${liveness.level}」（依据：${liveness.basis}，${humanizeDays(liveness.days)}），建议定期维护或声明维护状态` })
  }
  if (data.contributorCount === 1) {
    recos.push({ icon: '🚌', title: 'Bus Factor 风险', desc: '仅 1 位贡献者，建议培养更多维护者降低单点风险' })
  }
  if (data.prDays !== null && data.prDays > 30) {
    recos.push({ icon: '⏳', title: 'PR 处理缓慢', desc: `PR 平均处理 ${data.prDays} 天，建议加快 review 节奏` })
  }
  if (data.openPRCount > 50) {
    recos.push({ icon: '📥', title: 'PR 积压', desc: `${data.openPRCount} 个 Open PR，建议定期清理` })
  }
  if (scores.total < 40) {
    recos.push({ icon: '⚠️', title: '健康度偏低', desc: `总分 ${scores.total}/100，多项指标需改善` })
  }

  return recos.slice(0, 6)
}

/** 工具函数 */
function scoreColor(score, max = 100) {
  const pct = max ? (score / max) * 100 : score
  if (pct >= 70) return 'var(--green)'
  if (pct >= 40) return 'var(--amber)'
  return 'var(--rose)'
}

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function formatSize(kb) {
  if (kb == null) return '—'
  if (kb >= 1024 * 1024) return (kb / (1024 * 1024)).toFixed(1) + ' GB'
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB'
  return `${kb} KB`
}

function humanizeDays(days) {
  if (days == null) return '未知'
  if (days < 1) return '今天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  return months > 0 ? `${years} 年 ${months} 个月前` : `${years} 年前`
}

function langColor(lang) {
  const map = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
    Go: '#00ADD8', Rust: '#dea584', Java: '#b07219',
    'C++': '#f34b7d', C: '#555555', Ruby: '#701516',
    PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF',
    HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051',
    Vue: '#41b883', Dart: '#00B4AB', Lua: '#000080',
    Scala: '#c22d40', Perl: '#0298c3', R: '#198CE7',
  }
  return map[lang] || '#8b8b8b'
}
