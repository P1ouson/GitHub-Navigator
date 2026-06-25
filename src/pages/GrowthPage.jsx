import { useState, useEffect, useMemo } from 'react'
import { getContributions, getContributionStats } from '../lib/db.js'
import { matchKeyword } from '../lib/keywordMatch.js'

const ACHIEVEMENTS = [
  { key: 'first_fork', label: '初次 Fork', desc: '完成第一次仓库 Fork', icon: '🔱' },
  { key: 'first_pr', label: '初次 PR', desc: '提交第一个 Pull Request', icon: '🚀' },
  { key: 'five_total', label: '贡献者', desc: '累计 5 次贡献', icon: '⭐' },
  { key: 'three_repos', label: '探索者', desc: '向 3 个以上仓库贡献', icon: '🌍' },
  { key: 'ten_total', label: '活跃贡献者', desc: '累计 10 次贡献', icon: '🏆' },
]

const STAGES = [
  { min: 0, label: '开源新手', desc: '完成首次 Fork 或 PR', next: '5 次贡献', nextMin: 5 },
  { min: 5, label: '初级贡献者', desc: '累计 5 次贡献', next: '10 次贡献', nextMin: 10 },
  { min: 10, label: '活跃贡献者', desc: '累计 10 次贡献', next: '向更多仓库探索', nextMin: null },
]

// 技能树定义：按类别分组，每个技能关联关键词用于匹配贡献记录
const SKILL_TREE = [
  {
    category: '前端',
    icon: '🎨',
    skills: [
      { name: 'JavaScript', keywords: ['javascript', 'js', 'es6', 'es2015', 'ecmascript'] },
      { name: 'TypeScript', keywords: ['typescript', 'ts', 'tsx'] },
      { name: 'React', keywords: ['react', 'jsx', 'reactjs', 'nextjs', 'next.js', 'react-native'] },
      { name: 'Vue', keywords: ['vue', 'vuejs', 'vue2', 'vue3', 'nuxt', 'nuxtjs'] },
      { name: 'CSS', keywords: ['css', 'sass', 'scss', 'less', 'style', 'styled-component', 'tailwind', 'postcss'] },
      { name: 'HTML', keywords: ['html', 'html5', 'dom'] },
      { name: 'Webpack', keywords: ['webpack', 'vite', 'rollup', 'bundler'] },
      { name: 'Node.js 前端', keywords: ['node', 'nodejs', 'frontend', 'npm'] },
    ],
  },
  {
    category: '后端',
    icon: '⚙️',
    skills: [
      { name: 'Python', keywords: ['python', 'django', 'flask', 'fastapi', 'pytest'] },
      { name: 'Java', keywords: ['java', 'spring', 'springboot', 'jvm', 'gradle', 'maven'] },
      { name: 'Go', keywords: ['go', 'golang', 'gin'] },
      { name: 'Rust', keywords: ['rust', 'cargo', 'wasm', 'webassembly'] },
      { name: 'Node.js', keywords: ['node', 'nodejs', 'express', 'nestjs', 'koa'] },
      { name: 'Ruby', keywords: ['ruby', 'rails', 'rubygem'] },
      { name: 'PHP', keywords: ['php', 'laravel', 'symfony', 'composer'] },
      { name: 'C/C++', keywords: ['c', 'c++', 'cpp', 'cxx', 'clang', 'cmake'] },
      { name: '数据库', keywords: ['sql', 'mysql', 'postgresql', 'sqlite', 'mongodb', 'redis', 'database'] },
    ],
  },
  {
    category: 'DevOps',
    icon: '🚀',
    skills: [
      { name: 'Docker', keywords: ['docker', 'container', 'compose', 'dockerfile'] },
      { name: 'Kubernetes', keywords: ['kubernetes', 'k8s', 'helm', 'minikube'] },
      { name: 'CI/CD', keywords: ['ci-cd', 'cicd', 'pipeline', 'github-action', 'jenkins', 'workflow', 'gitlab-ci'] },
      { name: 'Linux', keywords: ['linux', 'shell', 'bash', 'unix', 'zsh', 'sh'] },
      { name: '基础设施', keywords: ['terraform', 'ansible', 'pulumi', 'cloudformation'] },
      { name: '监控', keywords: ['prometheus', 'grafana', 'monitoring', 'alert', 'datadog'] },
    ],
  },
  {
    category: '移动开发',
    icon: '📱',
    skills: [
      { name: 'Android', keywords: ['android', 'kotlin', 'android-sdk', 'jetpack'] },
      { name: 'iOS', keywords: ['ios', 'swift', 'swiftui', 'uikit', 'xcode'] },
      { name: 'Flutter', keywords: ['flutter', 'dart', 'flutter-widget'] },
      { name: 'React Native', keywords: ['react-native', 'expo', 'rn'] },
    ],
  },
  {
    category: '数据 & AI',
    icon: '🤖',
    skills: [
      { name: '机器学习', keywords: ['ml', 'machine-learning', 'tensorflow', 'pytorch', 'scikit-learn', 'ai'] },
      { name: '数据处理', keywords: ['data', 'pandas', 'numpy', 'etl', 'spark', 'hadoop'] },
      { name: '数据可视化', keywords: ['d3', 'chart', 'visualization', 'plotly', 'echarts'] },
    ],
  },
  {
    category: '工具 & 其他',
    icon: '🔧',
    skills: [
      { name: 'Git', keywords: ['git', 'github', 'gitlab', 'gitea'] },
      { name: 'Markdown', keywords: ['markdown', 'md', 'docs'] },
      { name: '正则表达式', keywords: ['regex', 'regexp', 'regular-expression'] },
      { name: 'API 设计', keywords: ['api', 'rest', 'graphql', 'grpc', 'openapi'] },
      { name: '测试', keywords: ['testing', 'jest', 'mocha', 'cypress', 'vitest', 'unittest'] },
      { name: '安全', keywords: ['security', 'auth', 'oauth', 'jwt', 'cryptography', 'ssl'] },
    ],
  },
]

// 学习路径：5 个阶段，每阶段配小任务，完成状态基于贡献统计
const LEARNING_PATH = [
  {
    step: 1,
    title: '了解开源文化',
    desc: '理解开源精神与协作方式',
    tasks: [
      { name: '阅读开源指南', hint: '了解开源协作的基本流程与社区规范' },
      { name: '了解 LICENSE 类型', hint: 'MIT / Apache-2.0 / GPL 的区别与选择' },
    ],
    // 阶段 1：完成首次贡献即视为已了解开源文化
    completed: (stats) => stats.total >= 1,
  },
  {
    step: 2,
    title: 'Git 基础操作',
    desc: '掌握 Fork、Commit、PR 的完整流程',
    tasks: [
      { name: 'Fork 一个仓库', hint: '在 GitHub 上 Fork 感兴趣的项目' },
      { name: '提交第一个 commit', hint: '克隆到本地并完成修改提交' },
      { name: '创建 Pull Request', hint: '把修改推送回上游仓库' },
    ],
    completed: (stats) => stats.forks >= 1,
  },
  {
    step: 3,
    title: '找到适合的 Issue',
    desc: '学会筛选与认领 Issue',
    tasks: [
      { name: '搜索 good first issue', hint: '用标签筛选适合新手的 Issue' },
      { name: '阅读 CONTRIBUTING.md', hint: '了解仓库的贡献规范与流程' },
    ],
    completed: (stats) => stats.issues >= 1 || stats.forks >= 1,
  },
  {
    step: 4,
    title: '提交第一个 PR',
    desc: '走完代码贡献的完整链路',
    tasks: [
      { name: '克隆仓库到本地', hint: 'git clone 并创建功能分支' },
      { name: '修改代码并测试', hint: '按 Issue 要求实现并本地验证' },
      { name: '提交 PR', hint: '推送分支并在 GitHub 发起 Pull Request' },
    ],
    completed: (stats) => stats.prs >= 1,
  },
  {
    step: 5,
    title: '成为活跃贡献者',
    desc: '持续贡献并参与社区协作',
    tasks: [
      { name: '持续贡献', hint: '累计 10 次以上贡献' },
      { name: '参与 Code Review', hint: 'Review 他人的 PR' },
      { name: '帮助新手', hint: '回答 Issue 中的提问' },
    ],
    completed: (stats) => stats.total >= 10,
  },
]

function computeAchievements(stats) {
  return ACHIEVEMENTS.map(a => {
    let earned = false
    if (a.key === 'first_fork') earned = stats.forks >= 1
    else if (a.key === 'first_pr') earned = stats.prs >= 1
    else if (a.key === 'five_total') earned = stats.total >= 5
    else if (a.key === 'three_repos') earned = stats.repos >= 3
    else if (a.key === 'ten_total') earned = stats.total >= 10
    return { ...a, earned }
  })
}

const TYPE_LABELS = { fork: 'Fork', pr: 'PR', issue: 'Issue' }
const TYPE_ICONS = { fork: '🔱', pr: '🚀', issue: '💬' }

// 贡献日历：聚合每天贡献数，生成 53 周网格
function buildCalendar(timeline) {
  const countByDate = {}
  timeline.forEach(item => {
    if (!item.createdAt) return
    const date = new Date(item.createdAt)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    countByDate[dateStr] = (countByDate[dateStr] || 0) + 1
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // 以本周为最后一列，向前推 52 周，共 53 列；周日为每周第一天
  const weeks = []
  const end = new Date(today)
  end.setDate(end.getDate() + (6 - end.getDay()))
  const start = new Date(end)
  start.setDate(start.getDate() - 7 * 52 - 6)

  for (let w = 0; w < 53; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(start)
      date.setDate(start.getDate() + w * 7 + d)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const count = countByDate[dateStr] || 0
      week.push({ date: dateStr, count, future: date > today })
    }
    weeks.push(week)
  }
  return { weeks, total: timeline.length }
}

// 根据贡献次数返回等级（0-3）
function getCellLevel(count) {
  if (count === 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  return 3
}

// 技能统计：从贡献记录中提取语言/技术关键词
function buildSkillStats(timeline) {
  const stats = {}
  const skillKeywords = {}
  SKILL_TREE.forEach(cat => {
    cat.skills.forEach(skill => {
      stats[skill.name] = { count: 0, lastDate: null }
      skillKeywords[skill.name] = skill.keywords
    })
  })

  timeline.forEach(item => {
    const text = `${item.repo || ''} ${item.language || ''} ${item.detail || ''}`.toLowerCase()
    Object.keys(stats).forEach(skillName => {
      // 短关键词（≤3字符）用单词边界匹配，长关键词用包含匹配（转发到公共模块）
      const matched = skillKeywords[skillName].some(kw => matchKeyword(text, kw))
      if (matched) {
        stats[skillName].count++
        const d = item.createdAt
        if (!stats[skillName].lastDate || d > stats[skillName].lastDate) {
          stats[skillName].lastDate = d
        }
      }
    })
  })

  return stats
}

// 计算学习路径状态：completed / current / locked
function computePathStages(stats) {
  let firstIncomplete = -1
  const completedFlags = LEARNING_PATH.map((stage, i) => {
    const done = stage.completed(stats)
    if (!done && firstIncomplete === -1) firstIncomplete = i
    return done
  })
  return LEARNING_PATH.map((stage, i) => {
    if (completedFlags[i]) return { ...stage, status: 'completed' }
    if (i === firstIncomplete) return { ...stage, status: 'current' }
    return { ...stage, status: 'locked' }
  })
}

export default function GrowthPage() {
  const [stats, setStats] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [achievements, setAchievements] = useState([])
  const [selectedSkill, setSelectedSkill] = useState(null)
  const [expandedStage, setExpandedStage] = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [s, t] = await Promise.all([getContributionStats(), getContributions()])
    setStats(s); setTimeline(t); setAchievements(computeAchievements(s))
  }

  const earnedCount = achievements.filter(a => a.earned).length
  const currentStage = STAGES.filter(s => (stats?.total || 0) >= s.min).pop() || STAGES[0]

  const calendar = useMemo(() => buildCalendar(timeline), [timeline])
  const skillStats = useMemo(() => buildSkillStats(timeline), [timeline])
  const activeSkillCount = useMemo(() => Object.values(skillStats).filter(s => s.count > 0).length, [skillStats])
  const pathStages = useMemo(() => stats
    ? computePathStages(stats)
    : LEARNING_PATH.map(s => ({ ...s, status: 'locked' })),
  [stats])

  return (
    <section className="section">
      <div className="section-inner">
        <div className="section-header">
          <div className="section-label">模块四</div>
          <h2>成长中心</h2>
          <p>记录每一次开源贡献，追踪你的成长轨迹</p>
        </div>

        {/* 当前阶段 + 下一成就 */}
        <div className="growth-current">
          <div className="current-phase">
            <span className="current-phase-badge">{currentStage.label}</span>
            <span className="current-phase-desc">{currentStage.desc}</span>
          </div>
          {currentStage.nextMin && (
            <div className="next-achievement">
              下一阶段：{currentStage.next}
              <div className="next-progress-track">
                <div className="next-progress-fill" style={{ width: `${Math.min(100, ((stats?.total || 0) / currentStage.nextMin) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* 统计面板 */}
        {stats && (
          <div className="growth-stats">
            <StatCard value={stats.total} label="总贡献" />
            <StatCard value={stats.forks} label="Fork" />
            <StatCard value={stats.prs} label="PR" />
            <StatCard value={stats.repos} label="参与仓库" />
          </div>
        )}

        {/* 贡献日历 */}
        <div className="growth-section-title">📅 贡献日历</div>
        <ContributionCalendar weeks={calendar.weeks} total={calendar.total} />

        {/* 技能树 */}
        <div className="growth-section-title">
          🌳 技能树 <span className="result-count">{activeSkillCount} 项已点亮</span>
        </div>
        <SkillTree
          skillStats={skillStats}
          selectedSkill={selectedSkill}
          onSelect={setSelectedSkill}
        />

        {/* 成就徽章 */}
        <div className="growth-achievements">
          <div className="growth-section-title">成就徽章 <span className="result-count">{earnedCount}/{ACHIEVEMENTS.length}</span></div>
          <div className="achievement-grid">
            {achievements.map(a => (
              <div key={a.key} className={`achievement-card${a.earned ? ' earned' : ''}`}>
                <div className="achievement-icon">{a.earned ? a.icon : '🔒'}</div>
                <div className="achievement-label">{a.label}</div>
                <div className="achievement-desc">{a.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 学习路径 */}
        <div className="growth-section-title">🗺️ 学习路径</div>
        <LearningPath
          stages={pathStages}
          expandedStage={expandedStage}
          onToggle={setExpandedStage}
        />

        {/* 贡献时间线（独立滚动） */}
        <div className="growth-section-title">贡献时间线</div>
        {timeline.length === 0 ? (
          <div className="empty-timeline">
            <div className="empty-timeline-icon">📋</div>
            <div className="empty-timeline-text">完成第一次贡献后，这里会显示你的成长轨迹</div>
            <a className="empty-cta-btn" href="/contribute">去贡献助手 →</a>
          </div>
        ) : (
          <div className="scroll-panel">
            {timeline.map((item, i) => (
              <div key={item.id || i} className="timeline-item">
                <div className="timeline-dot">{TYPE_ICONS[item.type] || '📌'}</div>
                <div className="timeline-content">
                  <div className="timeline-type">{TYPE_LABELS[item.type] || item.type}</div>
                  <div className="timeline-repo">{item.repo}</div>
                  {item.detail && <div className="timeline-detail">{item.detail}</div>}
                  <div className="timeline-time">{new Date(item.createdAt).toLocaleString('zh-CN')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function StatCard({ value, label }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

// 贡献日历组件：53 周 × 7 天的热力图
function ContributionCalendar({ weeks, total }) {
  const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  const weekdayLabels = ['', '一', '', '三', '', '五', '']

  // 计算月份标签出现的位置（月份变化时标注）
  const monthCols = []
  let lastMonth = -1
  weeks.forEach((week, w) => {
    const firstDay = new Date(week[0].date)
    const month = firstDay.getMonth()
    if (month !== lastMonth) {
      monthCols.push({ col: w, label: monthLabels[month] })
      lastMonth = month
    }
  })

  return (
    <div className="contribution-calendar">
      <div className="calendar-summary">
        过去一年共 <strong>{total}</strong> 次贡献
      </div>
      <div className="calendar-scroll">
        <div className="calendar-grid-wrap">
          {/* 月份标签行 */}
          <div className="calendar-months">
            <div className="calendar-corner" />
            {weeks.map((week, w) => {
              const m = monthCols.find(mc => mc.col === w)
              return <div key={w} className="calendar-month-label">{m ? m.label : ''}</div>
            })}
          </div>
          <div className="calendar-body">
            {/* 星期标签列 */}
            <div className="calendar-weekdays">
              {weekdayLabels.map((d, i) => (
                <div key={i} className="calendar-weekday-label">{d}</div>
              ))}
            </div>
            {/* 日期格子 */}
            <div className="calendar-grid">
              {weeks.map((week, w) => (
                <div key={w} className="calendar-week">
                  {week.map(cell => (
                    <div
                      key={cell.date}
                      className={`calendar-cell level-${getCellLevel(cell.count)}${cell.future ? ' future' : ''}`}
                      title={`${cell.date}：${cell.count} 次贡献`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="calendar-legend">
        <span className="calendar-legend-label">少</span>
        <div className="calendar-cell level-0" />
        <div className="calendar-cell level-1" />
        <div className="calendar-cell level-2" />
        <div className="calendar-cell level-3" />
        <span className="calendar-legend-label">多</span>
      </div>
    </div>
  )
}

// 技能树组件：按类别展示技能节点，点击查看详情
function SkillTree({ skillStats, selectedSkill, onSelect }) {
  return (
    <div className="skill-tree">
      {SKILL_TREE.map(cat => (
        <div key={cat.category} className="skill-category">
          <div className="skill-category-header">
            <span className="skill-category-icon">{cat.icon}</span>
            <span className="skill-category-name">{cat.category}</span>
          </div>
          <div className="skill-nodes">
            {cat.skills.map(skill => {
              const stat = skillStats[skill.name] || { count: 0, lastDate: null }
              const active = stat.count > 0
              const selected = selectedSkill === skill.name
              return (
                <button
                  key={skill.name}
                  className={`skill-node${active ? ' active' : ''}${selected ? ' selected' : ''}`}
                  onClick={() => onSelect(selected ? null : skill.name)}
                >
                  {skill.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {selectedSkill && (
        <div className="skill-detail">
          {(() => {
            const stat = skillStats[selectedSkill] || { count: 0, lastDate: null }
            return (
              <>
                <div className="skill-detail-name">{selectedSkill}</div>
                <div className="skill-detail-stats">
                  <span>贡献次数：<strong>{stat.count}</strong></span>
                  <span>最近贡献：{stat.lastDate ? new Date(stat.lastDate).toLocaleDateString('zh-CN') : '暂无记录'}</span>
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// 学习路径组件：5 个阶段，可展开查看任务
function LearningPath({ stages, expandedStage, onToggle }) {
  return (
    <div className="learning-path">
      {stages.map(stage => {
        const expanded = expandedStage === stage.step
        return (
          <div key={stage.step} className={`path-stage ${stage.status}`}>
            <div className="path-stage-header" onClick={() => onToggle(expanded ? null : stage.step)}>
              <div className="path-stage-num">
                {stage.status === 'completed' ? '✓' : stage.step}
              </div>
              <div className="path-stage-info">
                <div className="path-stage-title">{stage.title}</div>
                <div className="path-stage-desc">{stage.desc}</div>
              </div>
              <div className="path-stage-status">
                {stage.status === 'completed' && '已完成'}
                {stage.status === 'current' && '进行中'}
                {stage.status === 'locked' && '未解锁'}
              </div>
              <div className="path-stage-toggle">{expanded ? '▾' : '▸'}</div>
            </div>
            {expanded && (
              <div className="path-stage-tasks">
                {stage.tasks.map((task, i) => (
                  <div key={i} className="path-task">
                    <div className="path-task-bullet">•</div>
                    <div className="path-task-body">
                      <div className="path-task-name">{task.name}</div>
                      <div className="path-task-hint">{task.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
