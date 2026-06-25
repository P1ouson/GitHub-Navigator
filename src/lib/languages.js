/**
 * 语言检测 + 语言列表
 *
 * 用于：
 *   1. 搜索词里检测语言关键词 → 自动勾选语言筛选
 *   2. 语言筛选栏渲染（常见语言 + 冷门语言折叠）
 *
 * 数据来源：GitHub 官方语言列表（top 20 常见 + 200+ 全量）
 * https://github.com/github/linguist/blob/master/lib/linguist/languages.yml
 */

// 常见 20 种语言（默认展开显示）
export const POPULAR_LANGUAGES = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Go',
  'Rust', 'C++', 'C', 'C#', 'Ruby',
  'PHP', 'Swift', 'Kotlin', 'Dart', 'Scala',
  'Shell', 'HTML', 'CSS', 'Vue', 'Elixir',
]

// 全量语言列表（冷门语言折叠显示）
// 包含 GitHub Linguist 的主要语言
export const ALL_LANGUAGES = [
  // 常见
  ...POPULAR_LANGUAGES,
  // 其它主流
  'Objective-C', 'Perl', 'Lua', 'R', 'Haskell', 'Clojure', 'Erlang',
  'F#', 'OCaml', 'Crystal', 'Nim', 'Zig', 'V', 'Julia', 'Matlab',
  'Groovy', 'Gradle', 'Puppet', 'Chef', 'PowerShell', 'Batchfile',
  'Makefile', 'CMake', 'Dockerfile', 'Jupyter Notebook', 'TeX', 'Markdown',
  // JVM 系
  'Java Bytecode', 'Kotlin Script', 'ClojureScript', 'Golo',
  // 函数式
  'Elm', 'PureScript', 'ReasonML', 'ReScript', 'Idris', 'Agda',
  // 系统
  'Assembly', 'WebAssembly', 'SystemVerilog', 'Verilog', 'VHDL',
  // 脚本
  'AppleScript', 'AutoHotkey', 'CoffeeScript', 'LiveScript',
  // 数据/配置
  'SQL', 'PLSQL', 'TSQL', 'GraphQL', 'YAML', 'TOML', 'JSON', 'JSON5',
  'INI', 'XML', 'CSV', 'TSV',
  // 标记
  'AsciiDoc', 'RDoc', 'RMarkdown', 'Pod', 'MediaWiki',
  // 其它
  'ActionScript', 'Ada', 'Apex', 'Awk', 'Ballerina', 'Bison', 'Brainfuck',
  'C2hs', "Cap'n Proto", 'CartoCSS', 'Ceylon', 'Chapel', 'Clean', 'Click',
  'Closure Templates', 'Cloud Firestore Security Rules', 'CodeQL',
  'ColdFusion', 'Common Lisp', 'Component Pascal', 'Cool', 'Coq',
  'Cpp-ObjDump', 'Creole', 'Cython', 'D', 'D-ObjDump', 'DIGITAL Command Language',
  'DM', 'DTrace', 'Dylan', 'EBNF', 'ECL', 'ECLiPSe', 'EJS', 'Elixir',
  'Emacs Lisp', 'EmberScript', 'Erlang', 'Euphoria', 'F#', 'F*',
  'FIGlet Font', 'FLUX', 'Factor', 'Fancy', 'Fantom', 'Filebench WML',
  'Filterscript', 'Formatted', 'Forth', 'Fortran', 'FreeBasic', 'Frege',
  'G-code', 'GAMS', 'GAP', 'GCC Machine Description', 'GDB', 'GDScript',
  'GN', 'Game Maker Language', 'Genie', 'Genshi', 'Gentoo Ebuild',
  'Gentoo Eclass', 'Gerber Image', 'Glyph Bitmap Distribution Format',
  'Glyph', 'Grammatical Framework', 'Graph Modeling Language', 'GraphQL',
  'Hack', 'Haml', 'Handlebars', 'Harbour', 'Haxe', 'HCL', 'HLSL',
  'HolyC', 'Hy', 'HyPhy', 'IDL', 'IGOR Pro', 'INI', 'IRC log',
  'Idris', 'Ignore List', 'Inform 7', 'Inno Setup', 'Io', 'Ioke', 'Isabelle',
  'Isabelle ROOT', 'J', 'JFlex', 'JSONiq', 'JSONLD', 'JSX', 'Jasmin',
  'Java Properties', 'Java Server Pages', 'JavaScript', 'Jison', 'Jison Lex',
  'Jolie', 'JSON', 'JSON5', 'JSONiq', 'JSONLD', 'JSX', 'Jupyter Notebook',
]

// 语言别名映射（搜索词 → 标准语言名）
// 用户可能搜 "js" "ts" "py" 等缩写
const LANGUAGE_ALIASES = {
  'js': 'JavaScript',
  'javascript': 'JavaScript',
  'ts': 'TypeScript',
  'typescript': 'TypeScript',
  'py': 'Python',
  'python': 'Python',
  'java': 'Java',
  'go': 'Go',
  'golang': 'Go',
  'rust': 'Rust',
  'rs': 'Rust',
  'c++': 'C++',
  'cpp': 'C++',
  'c': 'C',
  'c#': 'C#',
  'csharp': 'C#',
  'cs': 'C#',
  'ruby': 'Ruby',
  'rb': 'Ruby',
  'php': 'PHP',
  'swift': 'Swift',
  'kotlin': 'Kotlin',
  'kt': 'Kotlin',
  'dart': 'Dart',
  'scala': 'Scala',
  'shell': 'Shell',
  'bash': 'Shell',
  'sh': 'Shell',
  'html': 'HTML',
  'css': 'CSS',
  'vue': 'Vue',
  'elixir': 'Elixir',
  'ex': 'Elixir',
  'exs': 'Elixir',
  'objective-c': 'Objective-C',
  'objc': 'Objective-C',
  'perl': 'Perl',
  'pl': 'Perl',
  'lua': 'Lua',
  'r': 'R',
  'haskell': 'Haskell',
  'hs': 'Haskell',
  'clojure': 'Clojure',
  'clj': 'Clojure',
  'erlang': 'Erlang',
  'f#': 'F#',
  'fsharp': 'F#',
  'ocaml': 'OCaml',
  'ml': 'OCaml',
  'crystal': 'Crystal',
  'nim': 'Nim',
  'zig': 'Zig',
  'julia': 'Julia',
  'matlab': 'Matlab',
  'groovy': 'Groovy',
  'gradle': 'Gradle',
  'powershell': 'PowerShell',
  'ps1': 'PowerShell',
  'makefile': 'Makefile',
  'cmake': 'CMake',
  'dockerfile': 'Dockerfile',
  'sql': 'SQL',
  'graphql': 'GraphQL',
  'yaml': 'YAML',
  'toml': 'TOML',
}

// 构建反向索引：小写别名 → 标准语言名
const ALIAS_INDEX = new Map()
for (const [alias, standard] of Object.entries(LANGUAGE_ALIASES)) {
  ALIAS_INDEX.set(alias.toLowerCase(), standard)
}

/**
 * 从搜索词中检测语言关键词
 * @param {string} query 用户搜索词
 * @returns {string[]} 检测到的标准语言名数组（如 ['Python']）
 */
export function detectLanguages(query) {
  if (!query) return []
  const detected = new Set()
  const lower = query.toLowerCase()

  // 按单词边界匹配（避免 "react" 匹配 "reason" 等）
  // 中文语境下语言名通常独立出现
  for (const [alias, standard] of ALIAS_INDEX) {
    // 用正则确保是独立单词（前后非字母）
    const re = new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`, 'i')
    if (re.test(lower)) {
      detected.add(standard)
    }
  }

  return [...detected]
}

/**
 * 从结果池聚合语言频次
 * @param {Array} items - issue 或 repo 列表
 * @param {'issue'|'repo'} type
 * @returns {Array<{name: string, count: number}>} 按频次降序
 */
export function aggregateLanguages(items, type) {
  const counts = new Map()
  for (const item of items) {
    let lang = null
    if (type === 'repo') {
      lang = item.language
    } else {
      // issue 的 language 在 _repoHealth 里
      lang = item._repoHealth?.language
    }
    if (!lang) continue
    counts.set(lang, (counts.get(lang) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 从结果池聚合 topics 频次（仅 repo）
 * @param {Array} items - repo 列表
 * @returns {Array<{name: string, count: number}>} 按频次降序，top 15
 */
export function aggregateTopics(items) {
  const counts = new Map()
  for (const item of items) {
    const topics = item.topics || []
    for (const t of topics) {
      if (!t) continue
      counts.set(t, (counts.get(t) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
