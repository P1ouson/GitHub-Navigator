import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: '首页' },
  { to: '/search', label: '搜索' },
  { to: '/analysis', label: '分析' },
  { to: '/explore', label: '漫游' },
  { to: '/social', label: '关系图谱' },
  { to: '/contribute', label: '贡献' },
  { to: '/growth', label: '成长' },
  { to: '/profile', label: '画像' },
]

export default function Navbar() {
  return (
    <nav className="nav">
      <NavLink to="/" className="nav-brand">
        <span className="nav-brand-mark">N</span>
        GitHub Navigator
      </NavLink>
      <div className="nav-right">
        <div className="nav-links">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}