import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { parseRepoUrl, getOctokit, safeGithub, getGitHubConfig } from '../lib/github.js'
import { usePersistState } from '../lib/pageCache.js'
import { useScrollReveal } from '../lib/useScrollReveal.js'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import { useNavigate } from 'react-router-dom'

/* ============================================================
 * 配色体系 —— 亮色主题：米白/灰/温和
 * ============================================================ */
const PALETTE = {
  bg: '#F5F5F2',
  panel: 'rgba(255,255,255,0.85)',
  panelSolid: '#FFFFFF',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.14)',
  text: '#1A1A2E',
  textSub: '#6B6B7B',
  textDim: '#9A9AAD',
  cream: '#8C7B6B',
  warm: '#8C7B6B',
  stone: '#6B6B7B',
}

/* 节点颜色：亮色背景上的温和中深色调 */
const NODE_COLOR = {
  main: '#2D2D44',          // 主仓库：深墨
  contributors: '#5B7C99',  // 贡献者：蓝灰
  forks: '#8C7B6B',         // Fork：暖棕灰
  branches: '#4A6B8C',      // 分支：石墨蓝
  organizations: '#9C8E6E', // 组织：卡其金
  related: '#6B6B7B',       // 关联仓库：中灰
}

function getGitHub() { return getOctokit() }

/* ============================================================
 * 工具：颜色处理
 * ============================================================ */
function darkenHex(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`
}

function lightenHex(hex, factor) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const nr = Math.round(r + (255 - r) * factor)
  const ng = Math.round(g + (255 - g) * factor)
  const nb = Math.round(b + (255 - b) * factor)
  return `rgb(${nr},${ng},${nb})`
}

/* ============================================================
 * 工具：创建文字标签 Sprite
 * ============================================================ */
function makeLabelSprite(text, color = '#6B6B7B', size = 6) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const fontSize = 36
  const font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
  ctx.font = font
  const textWidth = ctx.measureText(text).width
  canvas.width = Math.ceil(textWidth) + 24
  canvas.height = fontSize + 16
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  // 禁用 Sprite 的 raycast，防止拦截节点点击事件
  sprite.raycast = () => {}
  const ratio = canvas.width / canvas.height
  sprite.scale.set(size * ratio, size, 1)
  return sprite
}

/* ============================================================
 * 真实数据获取：调用 GitHub API 构建图谱数据
 * 优化：用 GraphQL 批量查询减少请求数，加超时保护
 * ============================================================ */
const FETCH_TIMEOUT = 15000

function withTimeout(promise, ms = FETCH_TIMEOUT) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function fetchRepoGraphData(owner, repo) {
  // 每次调用 getGitHub() 获取最新实例，避免持有过期引用（main.jsx 初始化前创建的无 token 实例）
  const gh = getGitHub()

  // 第一步：获取仓库基础信息（必须成功）+ 并发获取其他数据
  // 用 safeGithub 包装所有非关键请求，单个失败不影响整体
  const [repoInfoR, contributorsR, forksR, branchesR, relatedR] = await Promise.allSettled([
    withTimeout(gh.rest.repos.get({ owner, repo })),
    safeGithub(withTimeout(gh.rest.repos.listContributors({ owner, repo, per_page: 10 })), []),
    safeGithub(withTimeout(gh.rest.repos.listForks({ owner, repo, per_page: 5, sort: 'stargazers' })), []),
    safeGithub(withTimeout(gh.rest.repos.listBranches({ owner, repo, per_page: 5 })), []),
    safeGithub(withTimeout(gh.rest.search.repos({ q: `org:${owner}`, sort: 'stars', order: 'desc', per_page: 5 })), { data: { items: [] } }),
  ])

  // 仓库信息是必须的 — 限流时 fallback 到 search API（search 与 core 分开限流）
  let rd = null
  if (repoInfoR.status === 'fulfilled' && repoInfoR.value?.data) {
    rd = repoInfoR.value.data
  } else {
    const reason = repoInfoR.status === 'rejected' ? repoInfoR.reason : null
    // core API 限流 → 尝试 search.repos（走 search 限流池，未认证 10/h）
    if (reason?.status === 403 || reason?.status === 429) {
      try {
        const sr = await withTimeout(gh.rest.search.repos({ q: `repo:${owner}/${repo}`, per_page: 1 }))
        if (sr.data?.items?.[0]) {
          rd = sr.data.items[0]
          console.debug('[社交图谱] repos.get 限流，已 fallback 到 search.repos')
        }
      } catch { /* search 也失败则走下面的错误处理 */ }
    }
    if (!rd) {
      if (reason?.status === 404) throw new Error('仓库不存在（404），请确认地址正确')
      if (reason?.status === 403 || reason?.status === 429) {
        const cfg = getGitHubConfig()
        if (!cfg.token) {
          throw new Error('GitHub API 限流（未配置 Token，仅 60 次/小时）。请在设置中配置 GitHub Personal Access Token（提升至 5000 次/小时）')
        }
        throw new Error('GitHub API 限流（Token 额度已用完），请稍后重试或检查 Token 是否有效')
      }
      if (reason?.message?.includes('timeout')) throw new Error('获取仓库信息超时，请检查网络或代理设置')
      console.error('[社交图谱] repos.get 失败:', reason)
      throw new Error('获取仓库信息失败，请检查网络或代理设置')
    }
  }

  const repoInfo = {
    name: rd.full_name?.split('/')?.[1] || rd.name || rd.full_name,
    fullName: rd.full_name,
    desc: rd.description || '暂无描述',
    stars: rd.stargazers_count,
    forks: rd.forks_count,
    watchers: rd.subscribers_count || 0,
    defaultBranch: rd.default_branch,
    language: rd.language || '未知',
    license: rd.license?.name || '无',
    createdAt: rd.created_at?.slice(0, 10) || '未知',
    updatedAt: rd.updated_at?.slice(0, 10) || '未知',
    owner: rd.owner?.login || owner,
    ownerType: rd.owner?.type || 'User',
    url: rd.html_url,
    openIssues: rd.open_issues_count,
    ownerUrl: rd.owner?.html_url || `https://github.com/${owner}`,
    ownerAvatar: rd.owner?.avatar_url,
  }

  const contributors = ((contributorsR.status === 'fulfilled' ? contributorsR.value?.data : null) || [])
    .filter(c => c && c.login)
    .map(c => ({
      login: c.login,
      contributions: c.contributions || 0,
      org: owner,
      url: c.html_url || `https://github.com/${c.login}`,
      avatar: c.avatar_url,
    }))

  const forks = ((forksR.status === 'fulfilled' ? forksR.value?.data : null) || [])
    .filter(f => f)
    .map(f => ({
      fullName: f.full_name,
      stars: f.stargazers_count || 0,
      updated: f.updated_at?.slice(0, 10) || '未知',
      url: f.html_url,
      desc: f.description || 'Fork 仓库',
    }))

  const branches = ((branchesR.status === 'fulfilled' ? branchesR.value?.data : null) || [])
    .filter(b => b)
    .map(b => ({
      name: b.name,
      type: b.name === repoInfo.defaultBranch ? '默认分支' : '开发分支',
      lastCommit: b.commit?.commit?.author?.date?.slice(0, 10) || '未知',
    }))

  // 关联仓库：同 owner 下其他热门仓库（排除当前仓库）
  const relatedItems = (relatedR.status === 'fulfilled' ? relatedR.value?.data?.items : null) || []
  const related = relatedItems
    .filter(r => r && r.full_name !== repoInfo.fullName)
    .slice(0, 5)
    .map(r => ({
      fullName: r.full_name,
      stars: r.stargazers_count || 0,
      desc: r.description || '关联仓库',
      url: r.html_url,
    }))

  // 组织信息：直接用 repoInfo 里的 owner 信息，不再额外请求
  const organizations = [{
    name: repoInfo.owner,
    type: repoInfo.ownerType === 'Organization' ? 'Owner (Organization)' : 'Owner (User)',
    desc: `该仓库的拥有者：${repoInfo.owner}`,
    url: repoInfo.ownerUrl,
  }]

  return { repoInfo, contributors, forks, branches, organizations, related }
}

/* ============================================================
 * 图谱数据构建
 * ============================================================ */
function buildGraphData({ repoInfo, contributors, forks, branches, organizations, related }) {
  const nodes = []
  const links = []

  // 主仓库节点（中心，固定位置）
  const mainId = 'main'
  nodes.push({
    id: mainId,
    label: repoInfo.name,
    type: 'main',
    val: 28,
    data: repoInfo,
    fx: 0, fy: 0, fz: 0,
  })

  // 一级簇定义
  const clusterDefs = [
    { id: 'c-contributors', label: 'Contributors', category: 'contributors', items: contributors, count: contributors.length },
    { id: 'c-forks', label: 'Forks', category: 'forks', items: forks, count: forks.length },
    { id: 'c-branches', label: 'Branches', category: 'branches', items: branches, count: branches.length },
    { id: 'c-orgs', label: 'Organizations', category: 'organizations', items: organizations, count: organizations.length },
    { id: 'c-related', label: 'Related Repositories', category: 'related', items: related, count: related.length },
  ].filter(c => c.items.length > 0) // 空簇不显示

  // 一级簇节点：球面均匀分布，固定位置
  const R = 160
  clusterDefs.forEach((c, i) => {
    const angle = (i / clusterDefs.length) * Math.PI * 2
    c.type = 'cluster'
    c.val = 9
    c.fx = Math.cos(angle) * R
    c.fy = (i % 2 === 0 ? 1 : -1) * 20
    c.fz = Math.sin(angle) * R
    nodes.push(c)
    // 主仓库 → 一级簇：粗连线
    links.push({ source: mainId, target: c.id, kind: 'main', width: 2.5 })
  })

  // 子节点：围绕各自簇节点分布（不固定，力导向自动布局）
  const subR = 45
  clusterDefs.forEach(cluster => {
    cluster.items.forEach((item, i) => {
      const angle = (i / cluster.items.length) * Math.PI * 2
      let id, label, val, data, type
      if (cluster.category === 'contributors') {
        id = `contrib-${item.login}`
        label = item.login
        val = 3 + Math.log10(item.contributions + 1) * 1.2
        data = { ...item, type: 'contributor' }
        type = 'contributor'
      } else if (cluster.category === 'forks') {
        id = `fork-${item.fullName}`
        label = item.fullName.split('/')[1]
        val = 2.5 + Math.log10(item.stars + 1) * 1
        data = { ...item, type: 'fork' }
        type = 'fork'
      } else if (cluster.category === 'branches') {
        id = `branch-${item.name}`
        label = item.name
        val = 2.5
        data = { ...item, type: 'branch' }
        type = 'branch'
      } else if (cluster.category === 'organizations') {
        id = `org-${item.name}`
        label = item.name
        val = 3.5
        data = { ...item, type: 'organization' }
        type = 'organization'
      } else {
        id = `related-${item.fullName}`
        label = item.fullName.split('/')[1]
        val = 2.5 + Math.log10(item.stars + 1) * 0.8
        data = { ...item, type: 'related' }
        type = 'related'
      }
      nodes.push({
        id, label, type, val, data,
        x: cluster.fx + Math.cos(angle) * subR,
        y: cluster.fy + (Math.random() - 0.5) * 25,
        z: cluster.fz + Math.sin(angle) * subR,
      })
      links.push({ source: cluster.id, target: id, kind: cluster.category, width: 1.2 })
    })
  })

  return { nodes, links }
}

/* ============================================================
 * 顶部搜索栏
 * ============================================================ */
function TopSearchBar({ url, setUrl, onAnalyze, loading }) {
  return (
    <div className="rg-search" data-reveal>
      <div className="rg-search-brand">
        <span className="rg-search-mark">◇</span>
        <span className="rg-search-title">Repository Relationship Graph</span>
      </div>
      <div className="rg-search-row">
        <input
          className="rg-search-input"
          type="text"
          placeholder="输入 GitHub 仓库地址，如 https://github.com/vercel/next.js"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAnalyze()}
        />
        <button className="rg-search-btn" onClick={onAnalyze} disabled={loading || !url.trim()}>
          {loading ? '分析中…' : 'Analyze'}
        </button>
      </div>
    </div>
  )
}

/* ============================================================
 * 顶部统计卡片
 * ============================================================ */
function StatsOverview({ repo, contributors, branches }) {
  if (!repo) return null
  const stats = [
    { label: 'Contributors', value: contributors.length, icon: '👥' },
    { label: 'Commits', value: contributors.reduce((s, c) => s + (c.contributions || 0), 0).toLocaleString(), icon: '📝' },
    { label: 'Forks', value: repo.forks.toLocaleString(), icon: '🌿' },
    { label: 'Stars', value: repo.stars.toLocaleString(), icon: '⭐' },
    { label: 'Branches', value: branches.length, icon: '🔀' },
    { label: 'Open Issues', value: repo.openIssues.toLocaleString(), icon: '📋' },
  ]
  return (
    <div className="rg-stats">
      {stats.map(s => (
        <div className="rg-stat-card" key={s.label}>
          <span className="rg-stat-icon">{s.icon}</span>
          <span className="rg-stat-val">{s.value}</span>
          <span className="rg-stat-label">{s.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ============================================================
 * 左侧控制面板：图例 + 操作说明 + 功能按钮
 * ============================================================ */
function LeftControlPanel({ onReset, onFocus, onExportImage, onExportJson, rawData, highlightForks, highlightRelated, onToggleForks, onToggleRelated, searchQuery, onSearchChange, onSearchSelect, searchResults }) {
  const legend = [
    { color: NODE_COLOR.main, label: '主仓库' },
    { color: NODE_COLOR.contributors, label: '贡献者' },
    { color: NODE_COLOR.forks, label: 'Fork' },
    { color: NODE_COLOR.branches, label: '分支' },
    { color: NODE_COLOR.organizations, label: '组织' },
    { color: NODE_COLOR.related, label: '关联仓库' },
  ]

  return (
    <aside className="rg-left">
      {/* 节点搜索 */}
      {rawData?.repoInfo && (
        <div className="rg-panel-section">
          <div className="rg-panel-title">节点搜索</div>
          <div className="rg-search-box">
            <input
              className="rg-search-input-sm"
              type="text"
              placeholder="搜索节点名称…"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
            />
            {searchQuery && searchResults.length > 0 && (
              <div className="rg-search-results">
                {searchResults.slice(0, 8).map(r => (
                  <div
                    key={r.id}
                    className="rg-search-result-item"
                    onClick={() => onSearchSelect(r.id)}
                  >
                    <span className="rg-search-result-dot" style={{ background: r.type === 'main' ? NODE_COLOR.main : r.type === 'cluster' ? NODE_COLOR[r.category] : NODE_COLOR[r.type] || NODE_COLOR.related }} />
                    <span className="rg-search-result-name">{r.label}</span>
                    <span className="rg-search-result-type">{r.typeLabel}</span>
                  </div>
                ))}
              </div>
            )}
            {searchQuery && searchResults.length === 0 && (
              <div className="rg-search-no-results">未找到匹配节点</div>
            )}
          </div>
        </div>
      )}

      {/* 高亮工具 */}
      {rawData?.repoInfo && (
        <div className="rg-panel-section">
          <div className="rg-panel-title">高亮工具</div>
          <div className="rg-actions">
            <button
              className="rg-action-btn"
              onClick={onToggleForks}
              style={{ background: highlightForks ? '#4CAF50' : undefined, color: highlightForks ? '#fff' : undefined, border: highlightForks ? 'none' : undefined }}
            >
              {highlightForks ? '✅ Fork 高亮中' : '📍 高亮 Fork 仓库'}
            </button>
            <button
              className="rg-action-btn"
              onClick={onToggleRelated}
              style={{ background: highlightRelated ? '#4CAF50' : undefined, color: highlightRelated ? '#fff' : undefined, border: highlightRelated ? 'none' : undefined }}
            >
              {highlightRelated ? '✅ 关联仓库高亮中' : '📍 高亮关联仓库'}
            </button>
          </div>
        </div>
      )}

      <div className="rg-panel-section">
        <div className="rg-panel-title">图例</div>
        <div className="rg-legend">
          {legend.map(l => (
            <div className="rg-legend-item" key={l.label}>
              <span className="rg-legend-dot" style={{ background: l.color }} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rg-panel-section">
        <div className="rg-panel-title">操作</div>
        <div className="rg-controls-hint">
          <div className="rg-hint-row"><kbd>拖拽</kbd>旋转视角</div>
          <div className="rg-hint-row"><kbd>滚轮</kbd>缩放图谱</div>
          <div className="rg-hint-row"><kbd>Shift</kbd>+<kbd>拖拽</kbd>平移</div>
          <div className="rg-hint-row"><kbd>点击</kbd>查看详情</div>
          <div className="rg-hint-row"><kbd>双击</kbd>跳转分析页</div>
        </div>
      </div>

      <div className="rg-panel-section">
        <div className="rg-panel-title">动作</div>
        <div className="rg-actions">
          <button className="rg-action-btn" onClick={onReset}>重置视角</button>
          <button className="rg-action-btn" onClick={onFocus}>聚焦主仓库</button>
          <button className="rg-action-btn" onClick={onExportImage}>导出截图</button>
          <button className="rg-action-btn" onClick={onExportJson}>导出 JSON</button>
        </div>
      </div>
    </aside>
  )
}

/* ============================================================
 * 3D 图谱画布
 * ============================================================ */
function Graph3DCanvas({ graphData, onNodeClick, onNodeHover, hoveredNode, selectedNode, fgRef, highlightForks, highlightRelated, searchQuery }) {
  const containerRef = useRef(null)
  const [dims, setDims] = useState({ width: 800, height: 600 })

  // 监听容器尺寸变化
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) setDims({ width: Math.round(width), height: Math.round(height) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // 初始相机位置 + 缓慢推近动画（z 越小越近、图越大）
  useEffect(() => {
    if (!fgRef.current) return
    fgRef.current.cameraPosition({ x: 0, y: 60, z: 360 }, 1200)
  }, [fgRef])

  // 添加场景灯光（让 MeshStandardMaterial 正常显示发光质感）
  useEffect(() => {
    if (!fgRef.current) return
    const scene = fgRef.current.scene()
    if (!scene) return
    // 避免重复添加
    if (scene.userData.lightsAdded) return
    scene.userData.lightsAdded = true

    // 环境光（基础照明）
    const ambient = new THREE.AmbientLight(0xffffff, 0.65)
    scene.add(ambient)

    // 主光源（方向光，从右上前方打来）
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9)
    dirLight.position.set(200, 300, 200)
    scene.add(dirLight)

    // 补光（从左下后方打来，减少阴影面过暗）
    const fillLight = new THREE.DirectionalLight(0xdedcff, 0.4)
    fillLight.position.set(-200, -150, -200)
    scene.add(fillLight)

    // 点光源（中心暖光，强化主仓库视觉焦点）
    const pointLight = new THREE.PointLight(0xffe8c8, 0.6, 600)
    pointLight.position.set(0, 0, 0)
    scene.add(pointLight)
  }, [fgRef])

  // 节点颜色（用颜色变化模拟选中/暗化效果，支持高亮模式、搜索筛选）
  const nodeColor = useCallback(node => {
    const baseColor = node.type === 'main'
      ? NODE_COLOR.main
      : node.type === 'cluster'
        ? NODE_COLOR[node.category]
        : NODE_COLOR[node.type] || NODE_COLOR.related
    const isHl = hoveredNode?.id === node.id || selectedNode?.id === node.id

    if (isHl) return '#1A1A2E'

    // 搜索筛选：非匹配节点变暗
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      const matches = node.label?.toLowerCase().includes(q) || node.id?.toLowerCase().includes(q)
      if (!matches) return lightenHex(baseColor, 0.55)
    }

    // 高亮模式：Fork 或关联仓库节点加亮
    if (highlightForks && (node.type === 'fork' || (node.type === 'cluster' && node.category === 'forks'))) {
      return '#4CAF50'
    }
    if (highlightRelated && (node.type === 'related' || (node.type === 'cluster' && node.category === 'related'))) {
      return '#4CAF50'
    }

    // 有选中/hover 节点时，非相关节点变浅
    const active = hoveredNode || selectedNode
    if (active && node.id !== active.id) {
      const hasLink = graphData.links.some(l =>
        (l.source === active.id && l.target === node.id) ||
        (l.target === active.id && l.source === node.id)
      )
      if (!hasLink) {
        return lightenHex(baseColor, 0.35)
      }
    }
    return baseColor
  }, [hoveredNode, selectedNode, graphData, highlightForks, highlightRelated, searchQuery])

  // 连线颜色（按类型上色，hover 时高亮关联线）
  const LINK_COLOR_BY_KIND = {
    main: 'rgba(45,45,68,0.55)',          // 主仓库→簇：深墨
    contributors: 'rgba(91,124,153,0.45)', // 蓝灰
    forks: 'rgba(140,123,107,0.45)',       // 暖棕灰
    branches: 'rgba(74,107,140,0.45)',     // 石墨蓝
    organizations: 'rgba(156,142,110,0.45)',// 卡其金
    related: 'rgba(107,107,123,0.45)',     // 中灰
  }
  const linkColor = useCallback(link => {
    const active = hoveredNode || selectedNode
    const baseColor = LINK_COLOR_BY_KIND[link.kind] || 'rgba(45,45,68,0.3)'
    if (!active) return baseColor
    const involved = link.source.id === active.id || link.target.id === active.id
    // hover 时：关联线高亮，无关线淡化
    if (involved) {
      const hl = LINK_COLOR_BY_KIND[link.kind] || 'rgba(45,45,68,0.5)'
      return hl.replace(/0\.\d+\)/, '0.9)')
    }
    return 'rgba(45,45,68,0.06)'
  }, [hoveredNode, selectedNode])

  // 自定义节点 3D 对象：发光球体 + 光晕 + 文字标签
  const nodeThreeObject = useCallback(node => {
    const baseColor = node.type === 'main'
      ? NODE_COLOR.main
      : node.type === 'cluster'
        ? NODE_COLOR[node.category]
        : NODE_COLOR[node.type] || NODE_COLOR.related

    // 节点尺寸：主仓库最大，簇节点中等，子节点小
    const radius = node.type === 'main' ? 10
      : node.type === 'cluster' ? 6
      : 3.5

    // 用 Group 组合：核心球 + 外发光球 + 光晕 sprite + 文字标签
    const group = new THREE.Group()

    // 1. 核心球：MeshStandardMaterial 带发光
    const coreGeo = new THREE.SphereGeometry(radius, 32, 32)
    const coreMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: baseColor,
      emissiveIntensity: node.type === 'main' ? 0.6 : node.type === 'cluster' ? 0.4 : 0.25,
      roughness: 0.4,
      metalness: 0.3,
    })
    const core = new THREE.Mesh(coreGeo, coreMat)
    group.add(core)

    // 2. 外发光球：半透明大球，模拟光晕扩散
    const glowGeo = new THREE.SphereGeometry(radius * 1.6, 16, 16)
    const glowColor = lightenHex(baseColor, 0.3)
    const glowMat = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: node.type === 'main' ? 0.25 : node.type === 'cluster' ? 0.18 : 0.12,
      depthWrite: false,
    })
    const glow = new THREE.Mesh(glowGeo, glowMat)
    group.add(glow)

    // 3. 文字标签
    const labelColor = node.type === 'main'
      ? PALETTE.text
      : node.type === 'cluster'
        ? NODE_COLOR[node.category]
        : PALETTE.textSub
    const labelSize = node.type === 'main' ? 14 : node.type === 'cluster' ? 8 : 5
    const sprite = makeLabelSprite(node.label, labelColor, labelSize)
    sprite.position.y = -radius - 4
    group.add(sprite)

    return group
  }, [])

  if (!graphData || !graphData.nodes.length) {
    return (
      <div className="rg-graph" ref={containerRef}>
        <div className="rg-graph-empty">输入仓库地址后开始分析</div>
      </div>
    )
  }

  return (
    <div className="rg-graph" ref={containerRef}>
      <ForceGraph3D
        ref={fgRef}
        graphData={graphData}
        width={dims.width}
        height={dims.height}
        backgroundColor={PALETTE.bg}
        showNavInfo={false}
        nodeRelSize={2.5}
        nodeColor={nodeColor}
        nodeOpacity={0.95}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={true}
        linkColor={linkColor}
        linkWidth={link => link.width || 1.2}
        linkOpacity={0.65}
        linkDirectionalParticles={3}
        linkDirectionalParticleWidth={0.6}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleColor={() => 'rgba(45,45,68,0.55)'}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        onBackgroundClick={() => onNodeClick(null)}
        cooldownTicks={120}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.4}
        enableNodeDrag={true}
        warmupTicks={80}
        enablePointerInteraction={true}
      />
      {hoveredNode && <NodeTooltip node={hoveredNode} />}
    </div>
  )
}

/* ============================================================
 * 节点 hover tooltip
 * ============================================================ */
function NodeTooltip({ node }) {
  const typeLabel = {
    main: '主仓库',
    cluster: '关系簇',
    contributor: '贡献者',
    fork: 'Fork 仓库',
    branch: '分支',
    organization: '组织',
    related: '关联仓库',
  }[node.type] || '节点'

  return (
    <div className="rg-tooltip">
      <div className="rg-tooltip-type">{typeLabel}</div>
      <div className="rg-tooltip-name">{node.label}</div>
      {node.data?.contributions != null && (
        <div className="rg-tooltip-meta">{node.data.contributions} commits</div>
      )}
      {node.data?.stars != null && (
        <div className="rg-tooltip-meta">★ {node.data.stars.toLocaleString()}</div>
      )}
      {node.type === 'cluster' && (
        <div className="rg-tooltip-meta">{node.count} 项</div>
      )}
    </div>
  )
}

/* ============================================================
 * 右侧详情面板
 * ============================================================ */
function RightDetailPanel({ node, onNavigate }) {
  if (!node) {
    return (
      <aside className="rg-right">
        <div className="rg-detail-empty">
          <div className="rg-detail-empty-icon">◇</div>
          <div className="rg-detail-empty-text">点击任意节点查看详情</div>
          <div className="rg-detail-empty-hint">支持主仓库、贡献者、Fork、分支、组织、关联仓库</div>
          <div className="rg-detail-empty-hint" style={{ color: '#4CAF50', marginTop: '8px' }}>
            新手提示：点击绿色高亮的 Fork 或关联仓库节点，可以快速了解生态并找到入门项目
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="rg-right">
      <div className="rg-detail-card">
        <DetailContent node={node} onNavigate={onNavigate} />
      </div>
    </aside>
  )
}

function DetailContent({ node, onNavigate }) {
  // 主仓库详情
  if (node.type === 'main') {
    const r = node.data
    return (
      <>
        <div className="rg-detail-type">主仓库 · Repository</div>
        <div className="rg-detail-name">{r.fullName}</div>
        <p className="rg-detail-desc">{r.desc}</p>
        <div className="rg-detail-grid">
          <div className="rg-detail-item"><span className="rg-di-label">Stars</span><span className="rg-di-val">{r.stars.toLocaleString()}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">Forks</span><span className="rg-di-val">{r.forks.toLocaleString()}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">Watchers</span><span className="rg-di-val">{r.watchers.toLocaleString()}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">Open Issues</span><span className="rg-di-val">{r.openIssues.toLocaleString()}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">默认分支</span><span className="rg-di-val">{r.defaultBranch}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">主要语言</span><span className="rg-di-val">{r.language}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">License</span><span className="rg-di-val">{r.license}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">Owner</span><span className="rg-di-val">{r.owner}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">创建时间</span><span className="rg-di-val">{r.createdAt}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">更新时间</span><span className="rg-di-val">{r.updatedAt}</span></div>
        </div>
        <a className="rg-detail-link" href={r.url} target="_blank" rel="noopener noreferrer">Open on GitHub →</a>
        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <a
            className="rg-action-btn"
            href={`https://github.com/${r.fullName}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`}
            target="_blank"
            rel="noreferrer"
            style={{ textAlign: 'center', textDecoration: 'none', background: '#4CAF50', color: '#fff', border: 'none', fontSize: '12px' }}
          >
            🔍 查看入门 Issue（{r.openIssues?.toLocaleString()} 个）
          </a>
          <a
            className="rg-action-btn"
            href={`https://github.com/${r.fullName}/blob/${r.defaultBranch || 'main'}/CONTRIBUTING.md`}
            target="_blank"
            rel="noreferrer"
            style={{ textAlign: 'center', textDecoration: 'none', fontSize: '12px' }}
          >
            📖 查看贡献指南
          </a>
          <button
            className="rg-action-btn"
            onClick={(e) => { e.stopPropagation(); onNavigate(`/analysis?url=${encodeURIComponent(r.fullName)}`) }}
            style={{ fontSize: '12px' }}
          >
            📊 分析此仓库
          </button>
        </div>
      </>
    )
  }

  // 簇节点详情
  if (node.type === 'cluster') {
    const labels = {
      contributors: '贡献者', forks: 'Fork 仓库', branches: '分支',
      organizations: '关联组织', related: '关联仓库',
    }
    return (
      <>
        <div className="rg-detail-type">关系簇 · Cluster</div>
        <div className="rg-detail-name">{node.label}</div>
        <p className="rg-detail-desc">该仓库共有 {node.count} 个{labels[node.category]}。点击图谱中的子节点查看详细信息。</p>
        <div className="rg-detail-list">
          {node.items.slice(0, 6).map((item, i) => {
            const label = item.login || item.fullName || item.name
            const sub = item.contributions ? `${item.contributions} commits`
              : item.stars != null ? `★ ${item.stars.toLocaleString()}`
              : item.type || (item.desc?.length > 30 ? item.desc.slice(0, 30) + '…' : item.desc)
            return (
              <div className="rg-detail-list-item" key={i}>
                <span className="rg-dli-name">{label}</span>
                <span className="rg-dli-sub">{sub}</span>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  // 贡献者详情
  if (node.type === 'contributor') {
    const c = node.data
    const initials = c.login.slice(0, 2).toUpperCase()
    return (
      <>
        <div className="rg-detail-type">贡献者 · Contributor</div>
        <div className="rg-detail-contrib">
          <div className="rg-detail-avatar">{initials}</div>
          <div>
            <div className="rg-detail-name" style={{ marginBottom: 2 }}>{c.login}</div>
            <div className="rg-detail-meta">{c.org ? `所属 ${c.org}` : '独立贡献者'}</div>
          </div>
        </div>
        <div className="rg-detail-grid">
          <div className="rg-detail-item"><span className="rg-di-label">贡献次数</span><span className="rg-di-val">{c.contributions}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">活跃度</span><span className="rg-di-val">{c.contributions > 2000 ? '极高' : c.contributions > 500 ? '高' : c.contributions > 100 ? '中' : '低'}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">所属组织</span><span className="rg-di-val">{c.org || '-'}</span></div>
        </div>
        <a className="rg-detail-link" href={c.url} target="_blank" rel="noopener noreferrer">查看 GitHub 主页 →</a>
      </>
    )
  }

  // Fork 仓库详情
  if (node.type === 'fork') {
    const f = node.data
    return (
      <>
        <div className="rg-detail-type">Fork 仓库</div>
        <div className="rg-detail-name">{f.fullName}</div>
        <p className="rg-detail-desc">{f.desc}</p>
        <div className="rg-detail-grid">
          <div className="rg-detail-item"><span className="rg-di-label">Stars</span><span className="rg-di-val">{f.stars.toLocaleString()}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">更新时间</span><span className="rg-di-val">{f.updated}</span></div>
        </div>
        <div className="rg-detail-note">该仓库是 Fork 仓库，可能包含定制修改。</div>
        <a className="rg-detail-link" href={f.url} target="_blank" rel="noopener noreferrer">Open on GitHub →</a>
      </>
    )
  }

  // 分支详情
  if (node.type === 'branch') {
    const b = node.data
    return (
      <>
        <div className="rg-detail-type">分支 · Branch</div>
        <div className="rg-detail-name">{b.name}</div>
        <div className="rg-detail-grid">
          <div className="rg-detail-item"><span className="rg-di-label">类型</span><span className="rg-di-val">{b.type}</span></div>
          <div className="rg-detail-item"><span className="rg-di-label">最后提交</span><span className="rg-di-val">{b.lastCommit}</span></div>
        </div>
      </>
    )
  }

  // 组织详情
  if (node.type === 'organization') {
    const o = node.data
    return (
      <>
        <div className="rg-detail-type">组织 · Organization</div>
        <div className="rg-detail-name">{o.name}</div>
        <p className="rg-detail-desc">{o.desc}</p>
        <div className="rg-detail-grid">
          <div className="rg-detail-item"><span className="rg-di-label">关系</span><span className="rg-di-val">{o.type}</span></div>
        </div>
        <a className="rg-detail-link" href={o.url} target="_blank" rel="noopener noreferrer">查看组织主页 →</a>
      </>
    )
  }

  // 关联仓库详情
  if (node.type === 'related') {
    const r = node.data
    return (
      <>
        <div className="rg-detail-type">关联仓库 · Related</div>
        <div className="rg-detail-name">{r.fullName}</div>
        <p className="rg-detail-desc">{r.desc}</p>
        <div className="rg-detail-grid">
          <div className="rg-detail-item"><span className="rg-di-label">Stars</span><span className="rg-di-val">{r.stars.toLocaleString()}</span></div>
        </div>
        <a className="rg-detail-link" href={r.url} target="_blank" rel="noopener noreferrer">Open on GitHub →</a>
      </>
    )
  }

  return null
}

/* ============================================================
 * 主组件
 * ============================================================ */
export default function SocialPage() {
  const [url, setUrl] = usePersistState('social3d', 'url', '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hoveredNode, setHoveredNode] = useState(null)
  const [selectedNode, setSelectedNode] = usePersistState('social3d', 'selectedNodeId', null)
  const [rawData, setRawData] = usePersistState('social3d', 'rawData', null)
  const [highlightForks, setHighlightForks] = useState(false)
  const [highlightRelated, setHighlightRelated] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const fgRef = useRef(null)
  const navigate = useNavigate()
  useScrollReveal()

  // 图谱数据（基于真实数据构建）
  const graphData = useMemo(() => {
    if (!rawData) return { nodes: [], links: [] }
    return buildGraphData(rawData)
  }, [rawData])

  // 选中节点对象（从 id 恢复）
  const selectedNodeObj = useMemo(() => {
    if (!selectedNode) return null
    return graphData.nodes.find(n => n.id === selectedNode) || null
  }, [selectedNode, graphData])

  // 搜索结果
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const typeLabels = { main: '主仓库', cluster: '关系簇', contributor: '贡献者', fork: 'Fork', branch: '分支', organization: '组织', related: '关联' }
    return graphData.nodes
      .filter(n => n.label?.toLowerCase().includes(q) || n.id?.toLowerCase().includes(q))
      .map(n => ({ ...n, typeLabel: typeLabels[n.type] || n.type }))
  }, [searchQuery, graphData])

  // 分析：调用真实 GitHub API
  const analyze = useCallback(async () => {
    if (!url.trim()) return
    const parsed = parseRepoUrl(url)
    if (!parsed) { setError('无法解析仓库地址，请输入如 vercel/next.js 或 https://github.com/vercel/next.js'); return }
    const { owner, repo } = parsed
    setLoading(true)
    setError('')
    setRawData(null)
    setSelectedNode(null)
    setSearchQuery('')

    try {
      const data = await fetchRepoGraphData(owner, repo)
      setRawData(data)
      setSelectedNode('main')
    } catch (err) {
      console.error('[社交图谱] 获取数据失败:', err)
      setError(err.message || '获取数据失败，请检查网络或代理设置')
    } finally {
      setLoading(false)
    }
  }, [url, setRawData, setSelectedNode])

  // 节点点击
  const handleNodeClick = useCallback(node => {
    setSelectedNode(node?.id || null)
  }, [setSelectedNode])

  const handleNodeHover = useCallback(node => {
    setHoveredNode(node)
    document.body.style.cursor = node ? 'pointer' : 'default'
  }, [])

  // 重置视角
  const handleReset = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.cameraPosition({ x: 0, y: 80, z: 520 }, 800)
    }
  }, [fgRef])

  // 聚焦主仓库
  const handleFocus = useCallback(() => {
    if (fgRef.current) {
      fgRef.current.cameraPosition({ x: 0, y: 0, z: 200 }, 800)
    }
  }, [fgRef])

  // 搜索选中节点 → 聚焦相机
  const handleSearchSelect = useCallback((nodeId) => {
    setSelectedNode(nodeId)
    setSearchQuery('')
    const node = graphData.nodes.find(n => n.id === nodeId)
    if (node && fgRef.current) {
      const dist = node.type === 'main' ? 200 : node.type === 'cluster' ? 280 : 150
      fgRef.current.cameraPosition(
        { x: node.x || 0, y: (node.y || 0) + 40, z: (node.z || 0) + dist },
        800
      )
    }
  }, [graphData, setSelectedNode])

  // 高亮切换
  const handleToggleForks = useCallback(() => {
    setHighlightForks(!highlightForks)
    setHighlightRelated(false)
  }, [highlightForks])

  const handleToggleRelated = useCallback(() => {
    setHighlightRelated(!highlightRelated)
    setHighlightForks(false)
  }, [highlightRelated])

  // 导出截图
  const handleExportImage = useCallback(() => {
    if (!fgRef.current) return
    const renderer = fgRef.current.renderer()
    if (!renderer || !renderer.domElement) return
    renderer.render(fgRef.current.scene(), fgRef.current.camera())
    const dataURL = renderer.domElement.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = dataURL
    a.download = 'repository-graph.png'
    a.click()
  }, [fgRef])

  // 导出 JSON
  const handleExportJson = useCallback(() => {
    if (!rawData) return
    const data = JSON.stringify(rawData, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'repository-graph.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }, [rawData])

  return (
    <>
    <section className="rg-page">
      <TopSearchBar url={url} setUrl={setUrl} onAnalyze={analyze} loading={loading} />
      {rawData?.repoInfo && (
        <StatsOverview
          repo={rawData.repoInfo}
          contributors={rawData.contributors}
          branches={rawData.branches}
        />
      )}
      <LeftControlPanel
        onReset={handleReset}
        onFocus={handleFocus}
        onExportImage={handleExportImage}
        onExportJson={handleExportJson}
        rawData={rawData}
        highlightForks={highlightForks}
        highlightRelated={highlightRelated}
        onToggleForks={handleToggleForks}
        onToggleRelated={handleToggleRelated}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSelect={handleSearchSelect}
        searchResults={searchResults}
      />
      {error ? (
        <div className="rg-graph">
          <div className="rg-graph-error">
            <div className="rg-graph-error-icon">⚠</div>
            <div className="rg-graph-error-text">{error}</div>
            <div className="rg-graph-error-hint">请检查仓库地址是否正确，或在设置中配置 GitHub Token 和代理</div>
          </div>
        </div>
      ) : loading ? (
        <div className="rg-graph">
          <div className="rg-graph-loading">
            <div className="rg-graph-loading-spinner" />
            <div className="rg-graph-loading-text">正在获取仓库关系数据…</div>
          </div>
        </div>
      ) : (
        <Graph3DCanvas
          graphData={graphData}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          hoveredNode={hoveredNode}
          selectedNode={selectedNodeObj}
          fgRef={fgRef}
          highlightForks={highlightForks}
          highlightRelated={highlightRelated}
          searchQuery={searchQuery}
        />
      )}
      <RightDetailPanel node={selectedNodeObj} onNavigate={navigate} />
    </section>
    </>
  )
}
