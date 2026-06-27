import { useState, useCallback } from 'react'
import { searchRepositories } from '../lib/github.js'
import { chatStream } from '../lib/llm.js'
import { usePersistState } from '../lib/pageCache.js'

// 随机语言池
const LANG_POOL = [
  'JavaScript', 'TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C++', 'Ruby',
  'PHP', 'Swift', 'Kotlin', 'Dart', 'Scala', 'Elixir', 'Haskell', 'Clojure',
  'Lua', 'R', 'Julia', 'Zig', 'Nim', 'Crystal', 'OCaml', 'F#',
]

// 随机主题池
const TOPIC_POOL = [
  'web', 'cli', 'api', 'library', 'framework', 'tool', 'game',
  'machine-learning', 'compiler', 'database', 'devops', 'security',
  'mobile', 'desktop', 'embedded', 'visualization', 'docker',
]

// 随机 star 区间
const STAR_RANGES = [
  { min: 0, max: 10, label: '小众宝藏' },
  { min: 10, max: 100, label: '冉冉升起' },
  { min: 100, max: 1000, label: '社区热门' },
  { min: 1000, max: 10000, label: '明星项目' },
  { min: 10000, max: 50000, label: '超级巨星' },
  { min: 0, max: 50000, label: '随机' },
]

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomStarRange() {
  return pickRandom(STAR_RANGES)
}

export default function ExplorePage() {
  const [loading, setLoading] = useState(false)
  const [repo, setRepo] = usePersistState('explore', 'repo', null)
  const [aiDesc, setAiDesc] = usePersistState('explore', 'aiDesc', '')
  const [aiLoading, setAiLoading] = useState(false)
  const [tag, setTag] = usePersistState('explore', 'tag', '')
  const [error, setError] = useState('')

  const fetchRandom = useCallback(async () => {
    setLoading(true)
    setAiLoading(false)
    setError('')
    // 不立即清空 repo — 保留上一个结果直到新结果就绪

    try {
      let result, range, lang, topic, sort, page

      // 重试最多 3 次，每次换不同参数
      for (let attempt = 0; attempt < 3; attempt++) {
        lang = pickRandom(LANG_POOL)
        topic = Math.random() > 0.5 ? pickRandom(TOPIC_POOL) : ''
        range = randomStarRange()
        sort = Math.random() > 0.5 ? 'stars' : 'updated'
        page = Math.floor(Math.random() * 3) + 1

        try {
          result = await searchRepositories(topic || lang, {
            language: lang,
            minStars: range.min,
            maxStars: range.max,
            sort,
            fetchSize: 20,
          }, page)
        } catch (e) {
          // 区分不同错误类型
          if (e?.status === 403 || e?.message?.includes('rate limit') || e?.message?.includes('secondary rate limit')) {
            setError('GitHub 搜索 API 限流，请稍等一分钟再试')
            setLoading(false)
            return
          }
          if (e?.status === 401) {
            setError('GitHub Token 无效，请在设置中更新 Token')
            setLoading(false)
            return
          }
          if (e?.message?.includes('timeout') || e?.message?.includes('超时')) {
            setError('搜索超时，请检查网络后重试')
            setLoading(false)
            return
          }
          // 其他错误：继续重试
          console.warn('[漫游] 第', attempt + 1, '次尝试失败:', e.message)
          continue
        }

        if (result?.items?.length) break
      }

      if (!result?.items?.length) {
        setError('随机漫步没有找到结果，再点一次试试')
        setLoading(false)
        return
      }

      const pick = pickRandom(result.items)
      setRepo(pick)
      setTag(range.label)
      setAiDesc('')
      setLoading(false)

      // AI 生成一句话介绍（流式）
      setAiLoading(true)
      try {
        let desc = ''
        await chatStream(
          '你是一个开源项目推荐官。用一句话（不超过40字）介绍这个仓库，语言像朋友推荐一样自然，不要用"这个项目是..."开头。',
          `仓库名：${pick.name}\n描述：${pick.desc || '无'}\n语言：${pick.language || '未知'}\nStar：${pick.stars}\n话题：${(pick.topics || []).join(', ')}`,
          (chunk) => {
            desc += chunk
            setAiDesc(desc)
          },
          128
        )
        if (!desc) setAiDesc(pick.desc || '')
      } catch {
        setAiDesc(pick.desc || '')
      } finally {
        setAiLoading(false)
      }
    } catch (err) {
      console.warn('[漫游] 获取失败:', err.message)
      setError(`漫游失败：${err.message}`)
      setLoading(false)
    }
  }, [])

  return (
    <section className="section explore-page">
      <div className="section-inner" style={{ textAlign: 'center' }}>
        <div className="explore-hero">
          <h1 className="explore-title">开源漫游</h1>
          <p className="explore-subtitle">
            像在开源世界里散步，你不知道下一个遇见的是什么
          </p>
        </div>

        <div className="explore-card-wrap">
          {error && (
            <div className="explore-error">
              <p>{error}</p>
              <button className="explore-btn" onClick={fetchRandom}>重试</button>
            </div>
          )}

          {!repo && !loading && !error && (
            <div className="explore-empty">
              <div className="explore-empty-icon">🗺️</div>
              <p>点一下按钮，随机探索一个 GitHub 仓库</p>
              <button className="explore-btn" onClick={fetchRandom}>
                开始漫游
              </button>
            </div>
          )}

          {loading && (
            <div className="explore-loading">
              <div className="explore-loading-icon">🔍</div>
              <p>正在开源世界里寻找...</p>
            </div>
          )}

          {repo && !loading && (
            <div className="explore-card">
              <div className="explore-card-tag">{tag}</div>
              <div className="explore-card-lang">{repo.language || '?'}</div>
              <h2 className="explore-card-name">{repo.name}</h2>
              {repo.desc && <p className="explore-card-desc">{repo.desc}</p>}

              {/* AI 一句话推荐 */}
              <div className={`explore-ai-desc ${aiLoading ? 'loading' : ''}`}>
                {aiLoading ? (
                  <span className="explore-ai-loading">AI 正在解读...</span>
                ) : aiDesc ? (
                  <span>💡 {aiDesc}</span>
                ) : null}
              </div>

              <div className="explore-card-stats">
                <span>★ {repo.stars?.toLocaleString()}</span>
                <span>⑂ {repo.forks?.toLocaleString()}</span>
                {repo.openIssues > 0 && <span># {repo.openIssues}</span>}
              </div>

              <div className="explore-card-actions">
                <button className="explore-btn secondary" onClick={fetchRandom}>
                  换一个
                </button>
                <a
                  className="explore-btn primary"
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  去看看
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="explore-how">
          <h3>怎么玩的？</h3>
          <p>
            每次点击，系统会随机选一种语言、一个话题、一个 star 量级，从 GitHub 拉一批仓库，
            再随机挑一个展示给你。AI 还会用一句话告诉你这个仓库为什么有意思。
          </p>
        </div>
      </div>
    </section>
  )
}