import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getGlobalStats } from '../lib/github.js'
import { useScrollReveal } from '../lib/useScrollReveal.js'

const highlights = [
  { icon: '⚡', title: '开箱即用', desc: '无需配置即可搜索、分析、Fork，核心功能完全免费' },
  { icon: '🧠', title: 'LLM 增强', desc: '可选接入大模型，智能解读 Issue、润色 PR 描述' },
  { icon: '🔒', title: '本地数据', desc: '贡献记录加密存储在你的浏览器中，不上传服务器' },
]

const modules = [
  { to: '/search', icon: '🔍', title: '聚合搜索', desc: '一个搜索框，搜遍开源世界', color: 'accent' },
  { to: '/analysis', icon: '📊', title: '仓库分析', desc: '项目画像与健康度报告', color: 'green' },
  { to: '/explore', icon: '🧭', title: '仓库漫游', desc: '随机发现优质项目', color: 'amber' },
  { to: '/social', icon: '🕸️', title: '关系图谱', desc: '可视化仓库关联网络', color: 'green' },
  { to: '/contribute', icon: '🤝', title: '贡献助手', desc: '从 Fork 到 PR 全流程', color: 'amber' },
  { to: '/growth', icon: '🏆', title: '成长中心', desc: '技能树与成就徽章', color: 'accent' },
  { to: '/profile', icon: '🎨', title: '能力画像', desc: '技术画像与项目推荐', color: 'green' },
]

// 使用流程：从发现到成长的四步路径
const STEPS = [
  { icon: '🔍', title: '搜索发现', desc: '用聚合搜索找到适合新手的项目与 Issue', to: '/search' },
  { icon: '📊', title: '分析评估', desc: '查看仓库健康度、活跃度与贡献门槛', to: '/analysis' },
  { icon: '🤝', title: '贡献代码', desc: 'Fork 仓库、本地修改、提交 PR 全流程引导', to: '/contribute' },
  { icon: '🏆', title: '记录成长', desc: '累积成就徽章，构建你的技术画像', to: '/growth' },
]

// 热门语言快捷入口
const QUICK_LANGS = [
  { name: 'JavaScript', icon: '🟨' },
  { name: 'TypeScript', icon: '🟦' },
  { name: 'Python', icon: '🐍' },
  { name: 'Go', icon: '🔵' },
  { name: 'Rust', icon: '🦀' },
  { name: 'Java', icon: '☕' },
  { name: 'C++', icon: '⚙️' },
  { name: 'Ruby', icon: '💎' },
]

// 场景引导卡片 — 悬停展开子选项
const SCENARIOS = [
  {
    icon: '🟢',
    title: '我要贡献代码',
    desc: '找到适合新手的 Issue',
    color: 'green',
    items: [
      { label: 'Good First Issue', query: 'good first issue' },
      { label: 'Help Wanted', query: 'help wanted' },
      { label: '文档贡献', query: 'documentation good first issue' },
    ],
  },
  {
    icon: '📦',
    title: '我要找项目',
    desc: '按语言发现热门仓库',
    color: 'accent',
    items: [
      { label: 'Python 项目', query: 'Python 开源项目' },
      { label: 'React 项目', query: 'React 开源项目' },
      { label: 'Go 项目', query: 'Go 开源项目' },
    ],
  },
  {
    icon: '❓',
    title: '我要学知识',
    desc: 'GitHub 与开源基础',
    color: 'amber',
    items: [
      { label: '什么是 Fork', query: '什么是 Fork' },
      { label: '如何提 PR', query: '如何提 Pull Request' },
      { label: 'Git 基础', query: 'Git 基础教程' },
    ],
  },
]

// 数字增长动画：从 0 缓动到目标值
function AnimatedNumber({ value, decimals = 1 }) {
  const [display, setDisplay] = useState(null)
  useEffect(() => {
    if (value == null) return
    let raf
    const start = performance.now()
    const dur = 1400
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(value * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  if (display == null) return <>…</>
  return <>{(display / 1000).toFixed(decimals)}K</>
}

export default function HomePage() {
  const [query, setQuery] = useState('')
  const [stats, setStats] = useState(null)
  const [selectedType, setSelectedType] = useState(null)
  const navigate = useNavigate()
  const inputRef = useRef(null)

  useScrollReveal()

  useEffect(() => {
    getGlobalStats().then(setStats).catch(() => {})
    const timer = setInterval(() => {
      getGlobalStats().then(s => { if (s) setStats(s) }).catch(() => {})
    }, 60 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const handleSearch = (e) => {
    e.preventDefault()
    if (!query.trim()) return
    const fullQ = selectedType ? `${selectedType} ${query.trim()}` : query.trim()
    navigate(`/search?q=${encodeURIComponent(fullQ)}`)
  }

  const goSearch = (q) => {
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  // 类型按钮：点击切换选中态（再点取消），不修改输入框内容
  const toggleType = (bang) => {
    setSelectedType(prev => prev === bang ? null : bang)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  // CTA 按钮：平滑滚动到搜索框并聚焦
  const scrollToSearch = () => {
    const el = document.querySelector('.home-quickstart')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => inputRef.current?.focus(), 500)
  }

  return (
    <div className="home-page">
      {/* Hero — 渐变标题 + 浮动光斑背景 */}
      <section className="home-hero">
        <div className="hero-aurora" aria-hidden="true">
          <span className="aurora-blob aurora-1" />
          <span className="aurora-blob aurora-2" />
          <span className="aurora-blob aurora-3" />
          <span className="hero-grid-bg" />
        </div>
        <div className="hero-content">
          <span className="hero-badge" data-reveal>✦ 开源贡献的起点</span>
          <h1 data-reveal>
            从<em>第一个 Issue</em><br />到<em>第一个 PR</em>
          </h1>
          <p className="home-hero-sub" data-reveal>
            找任务、挑项目、学知识 —— 我们帮你把 GitHub 的复杂，变成新手的清晰。
          </p>
          <div className="hero-cta" data-reveal>
            <button className="hero-cta-primary" onClick={scrollToSearch}>
              开始探索 <span className="cta-arrow">→</span>
            </button>
            <Link to="/explore" className="hero-cta-ghost">随便逛逛</Link>
          </div>
        </div>
      </section>

      {/* 痛点引导：新手困境 → 我们的解法 */}
      <section className="home-pain-section" data-reveal>
        <div className="home-pain-inner">
          <div className="pain-col">
            <div className="pain-emoji">😕</div>
            <h3>找不到适合的项目</h3>
            <p>面对 GitHub 上海量的仓库，新手常常一筹莫展——不知道哪个项目友好、哪个 Issue 能上手，在搜索里反复翻找却越看越迷茫。</p>
          </div>
          <div className="pain-divider"><span>我们解决</span></div>
          <div className="pain-col pain-col-solution">
            <div className="pain-emoji">✨</div>
            <h3>一个搜索框，自动匹配</h3>
            <p>用自然语言描述你的需求，系统自动识别意图：找仓库、找 Issue、学知识还是查代码，并按新手友好度排序，把最适合你的结果放在最前面。</p>
          </div>
        </div>
      </section>

      {/* 快速开始区 */}
      <section className="home-quickstart" data-reveal>
        {/* 语言快捷入口 */}
        <div className="quick-langs">
          <span className="quick-langs-label">热门语言：</span>
          {QUICK_LANGS.map(lang => (
            <button
              key={lang.name}
              className="quick-lang-btn"
              onClick={() => goSearch(`${lang.name} good first issue`)}
              title={`搜索 ${lang.name} 新手 Issue`}
            >
              <span className="quick-lang-icon">{lang.icon}</span>
              {lang.name}
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <form className="search-box" onSubmit={handleSearch}>
          <input
            ref={inputRef}
            className="search-box-input"
            type="text"
            placeholder="搜索 Issue、仓库、代码，或问一个问题..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="search-box-btn" type="submit">搜索</button>
        </form>

        {/* 搜索类型快捷按钮：点击切换选中态（高亮），不写入输入框 */}
        <div className="search-type-bar">
          <span className="search-type-label">类型：</span>
          <button className={`search-type-btn ${selectedType === '!repo' ? 'active' : ''}`} onClick={() => toggleType('!repo')}>!repo</button>
          <button className={`search-type-btn ${selectedType === '!issue' ? 'active' : ''}`} onClick={() => toggleType('!issue')}>!issue</button>
          <button className={`search-type-btn ${selectedType === '!code' ? 'active' : ''}`} onClick={() => toggleType('!code')}>!code</button>
          <button className={`search-type-btn ${selectedType === '!qa' ? 'active' : ''}`} onClick={() => toggleType('!qa')}>!qa</button>
        </div>

        {/* 场景引导卡片 */}
        <div className="scenario-grid">
          {SCENARIOS.map(sc => (
            <div key={sc.title} className={`scenario-card scenario-${sc.color}`}>
              <div className="scenario-card-front">
                <span className="scenario-icon">{sc.icon}</span>
                <div className="scenario-title">{sc.title}</div>
                <div className="scenario-desc">{sc.desc}</div>
              </div>
              <div className="scenario-card-back">
                {sc.items.map(item => (
                  <button
                    key={item.label}
                    className="scenario-item"
                    onClick={() => goSearch(item.query)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 使用引导：交互式步骤展示 */}
      <section className="home-guide-section" data-reveal>
        <div className="section-inner">
          <div className="section-header">
            <div className="section-label">快速上手</div>
            <h2>30 秒搞懂怎么用</h2>
            <p>跟着下面的步骤，轻松找到你的第一个开源贡献</p>
          </div>
          <div className="guide-steps">
            <div className="guide-step" data-reveal="left">
              <div className="guide-step-num">1</div>
              <div className="guide-step-icon">⌨️</div>
              <div className="guide-step-content">
                <div className="guide-step-title">输入你想找的内容</div>
                <div className="guide-step-desc">
                  在搜索框输入关键词，比如 <code>good first issue</code> 或 <code>Python 开源项目</code>。
                  也可以用 <code>!issue</code> <code>!repo</code> <code>!code</code> 指定搜索类型。
                </div>
              </div>
            </div>
            <div className="guide-step-connector" />
            <div className="guide-step" data-reveal="right">
              <div className="guide-step-num">2</div>
              <div className="guide-step-icon">🔍</div>
              <div className="guide-step-content">
                <div className="guide-step-title">浏览和筛选结果</div>
                <div className="guide-step-desc">
                  结果会按新手友好度排序。用左侧筛选栏按语言、标签、难度过滤。
                  每个结果卡片上都有「分析此仓库」和「开始贡献」按钮，一键跳转。
                </div>
              </div>
            </div>
            <div className="guide-step-connector" />
            <div className="guide-step" data-reveal="left">
              <div className="guide-step-num">3</div>
              <div className="guide-step-icon">📊</div>
              <div className="guide-step-content">
                <div className="guide-step-title">分析仓库健康度</div>
                <div className="guide-step-desc">
                  查看活跃度、新手友好度、维护质量等多维度评分，AI 帮你解读项目画像。
                  分析完成后可直接跳转到贡献助手。
                </div>
              </div>
            </div>
            <div className="guide-step-connector" />
            <div className="guide-step" data-reveal="right">
              <div className="guide-step-num">4</div>
              <div className="guide-step-icon">🤝</div>
              <div className="guide-step-content">
                <div className="guide-step-title">一键 Fork 并提交 PR</div>
                <div className="guide-step-desc">
                  输入仓库地址一键 Fork，选择 Issue，获取本地开发命令，
                  最后提交 PR 到 GitHub —— 全流程引导，零门槛。
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 统计面板 — 数字增长动画 */}
      <section className="section" data-reveal>
        <div className="section-inner">
          <div className="section-header">
            <div className="section-label">实时数据</div>
            <h2>开源世界，比你想象的更欢迎新手</h2>
            <p>每一分钟都有新的入门任务被打上标签，每一个数字背后都是一个等你接手的机会</p>
          </div>
          <div className="home-stats">
            <button className="home-stat-card" onClick={() => goSearch('good first issue')}>
              <div className="home-stat-num"><AnimatedNumber value={stats?.beginnerRepos} /></div>
              <div className="home-stat-label">新手友好仓库</div>
              <div className="home-stat-hint">含 good first issue 标签</div>
            </button>
            <button className="home-stat-card" onClick={() => goSearch('good first issue')}>
              <div className="home-stat-num"><AnimatedNumber value={stats?.goodFirstIssues} /></div>
              <div className="home-stat-label">Good First Issues</div>
              <div className="home-stat-hint">等待你贡献的入门任务</div>
            </button>
            <button className="home-stat-card" onClick={() => goSearch('help wanted')}>
              <div className="home-stat-num"><AnimatedNumber value={stats?.helpWantedIssues} /></div>
              <div className="home-stat-label">Help Wanted</div>
              <div className="home-stat-hint">社区正在寻求帮助的问题</div>
            </button>
          </div>
        </div>
      </section>

      {/* 使用流程 */}
      <section className="section section-alt" data-reveal>
        <div className="section-inner">
          <div className="section-header">
            <div className="section-label">使用流程</div>
            <h2>四步开启你的开源之旅</h2>
            <p>从零开始，一步步完成你的第一个开源贡献</p>
          </div>
          <div className="steps-flow">
            {STEPS.map((s, i) => (
              <Link key={s.to} to={s.to} className="step-card" style={{ transitionDelay: `${i * 90}ms` }} data-reveal>
                <div className="step-index">{String(i + 1).padStart(2, '0')}</div>
                <div className="step-icon">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                {i < STEPS.length - 1 && <div className="step-arrow">→</div>}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 模块入口 */}
      <section className="section" data-reveal>
        <div className="section-inner">
          <div className="section-header">
            <div className="section-label">核心功能</div>
            <h2>七大模块，覆盖开源全流程</h2>
            <p>从发现项目到完成 PR，从能力评估到成长记录，每一环都设计为可独立使用</p>
          </div>
          <div className="module-grid">
            {modules.map((m, i) => (
              <Link key={m.to} to={m.to} className={`module-card module-card-${m.color}`} style={{ transitionDelay: `${(i % 4) * 70}ms` }} data-reveal>
                <div className="module-card-icon">{m.icon}</div>
                <h3>{m.title}</h3>
                <p>{m.desc}</p>
                <span className="module-card-go">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 特色亮点 */}
      <section className="section section-alt" data-reveal>
        <div className="section-inner">
          <div className="section-header">
            <div className="section-label">为什么选择</div>
            <h2>为新手设计的开源入口</h2>
            <p>不侵入 GitHub，不要求技术背景，降低一切参与门槛</p>
          </div>
          <div className="highlights-grid">
            {highlights.map((h, i) => (
              <div key={h.title} className="highlight-card" style={{ transitionDelay: `${i * 80}ms` }} data-reveal>
                <div className="highlight-icon">{h.icon}</div>
                <h3>{h.title}</h3>
                <p>{h.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA 召唤区 */}
      <section className="home-cta-section" data-reveal>
        <div className="home-cta-box">
          <div className="home-cta-glow" aria-hidden="true" />
          <h2>准备好开始了吗？</h2>
          <p>无需注册，无需配置，现在就找到你的第一个开源贡献</p>
          <button className="home-cta-btn" onClick={() => navigate('/search')}>
            立即搜索 <span>→</span>
          </button>
        </div>
      </section>
    </div>
  )
}
