/**
 * 聚合搜索路由器 + 查询改写器
 *
 * 根据用户输入生成搜索计划 JSON：
 *   { confidence, category, sources, query_by_source, fallback, reason }
 *
 * 核心原则：
 *   1. 先判断"确定性"，再决定"搜索范围"
 *   2. 不确定时必须全搜：repo + issue + code + knowledge + web
 *   3. 短查询、泛词、项目名、代号 → mixed/unknown → 全搜
 *   4. 每个来源使用"轻量改写"的查询词，不乱加限定条件
 *   5. 不编造用户没说过的语言、标签、技术栈、仓库名、组织名
 */

// ===== bang 前缀（确定性意图，high confidence）=====
const BANG_MAP = {
  '!repo': 'repo', '!仓库': 'repo', '!项目': 'repo',
  '!issue': 'issue', '!问题': 'issue',
  '!code': 'code', '!代码': 'code',
  '!qa': 'qa', '!问': 'qa',
}

// ===== 分类模式 =====

// QA 概念型引导词（什么是/是什么/为什么/解释/原理/概念 等，出现在句中任意位置即触发 QA）
// 优先级最高（仅次于 repo 路径），优先于一切 issue/code 信号
// 因为 "什么是合并冲突" "为什么 git push 失败" "Spring Boot 自动配置原理" 都应判为 QA（求知型）
const QA_CONCEPT_PATTERNS = [
  /什么是|是什么|什么叫|怎么理解|如何理解|为什么|为何|为啥|解释一下|解释|了解一下|了解|原理|概念/,
  /\bwhat is\b/i, /\bwhy\b/i, /\bexplain\b/i, /\bwhat does\b/i,
  /\bdifference between\b/i, /\bprinciple\b/i, /\bconcept\b/i,
]

// QA 方法型引导词（怎么/如何/how to 等，必须在句首，after 噪声词）
// 与 ACTUAL_ERROR 配合：有实际报错词 → issue，无 → QA
const QA_METHOD_LEAD_PATTERNS = [
  /^(请问|麻烦|帮我|我想|我要|能不能|可以|请|麻烦您|求一个|求)*\s*(怎么|如何|怎样|怎么办|怎么做|怎么用|怎么使用|怎么给|怎么参与|怎么贡献|怎么加入|怎么开始|怎么学习|怎么入门|怎么写|怎么提|怎么配置|怎么解决|怎么排查|怎么修复|怎么微调|怎么维护|怎么成为|怎么报告)/,
  /^(please\s+)?(how to|how do|how does|how can|how should|how could)\b/i,
]

// QA 句尾模式（是什么/？等在句尾）
const QA_END_PATTERNS = [
  /(是什么|什么叫)$/,
  /[?？]+$/,
]

// QA 对比/选择类（vs/对比/区别/哪个好）— 强信号，优先于 code API
const QA_COMPARISON_PATTERNS = [
  /哪个好|哪个更好|哪个好一点|哪个|区别|对比|和.*比|与.*比|有哪些|有没有/,
  /\bvs\b/i, /\bcompare\b/i, /\bwhich is better\b/i, /\bwhich\b/i,
]

// QA 学习型（使用教程/使用方法/怎么用 等）
// "教程" 在 REPO_RESOURCE_PATTERNS 里也会命中 repo，但学习型教程（基础/入门/新手/快速等）
// 明显是求知意图，必须在 QA 阶段提前拦截，优先级高于 repo 资源词
const QA_LEARNING_PATTERNS = [
  /使用教程|使用方法|怎么用|如何使用|用法/,
  /基础教程|入门教程|学习教程|新手教程|快速教程|完整教程|详细教程|初级教程|高级教程|实战教程|速成教程|免费教程|视频教程|图文教程/,
  /教程.*(怎么|如何|基础|入门|学习|新手|快速|完整|详细|初级|高级|实战|速成|免费|视频|图文)/,
  /(怎么|如何|基础|入门|学习|新手|快速|完整|详细|初级|高级|实战|速成|免费|视频|图文).*教程/,
]

// QA 通用（其他提问词，兜底，包含"怎么/如何"任意位置出现）
const QA_GENERAL_PATTERNS = [
  /怎么办|咋办|咋整|求助|跪求|求大佬/,
  /怎么|如何/,
  /吗$/,
  /\bhow can\b/i,
]

// ACTUAL_ERROR：实际报错词（强信号，优先于 code API）
// 出现这些词说明用户遇到了真实错误，要搜同类 issue
const ACTUAL_ERROR_PATTERNS = [
  /报错|失败|崩溃|闪退|白屏|黑屏|死机|溢出|泄漏|拒绝|卡死|超时|拒绝访问|权限不足|找不到|不存在|无效|非法/,
  /死锁|阻塞|爆炸|不收敛|不匹配|不一致|丢失|乱码|超限|占满|内存满|挂掉|宕机|掉线|断开|卡顿|无响应|不工作|不生效|没反应|雪崩|穿透|击穿|不执行|不兼容|不收敛/,
  // 英文实际报错
  /\bfailed\b/i, /\bcrash/i, /\bcrash loop\b/i, /\bOOM\b/i, /\bout of memory\b/i,
  /\bsegfault\b/i, /\bsegmentation fault\b/i, /\bcore dumped\b/i, /\bdumped\b/i, /\bdump\b/i,
  /\bblocked\b/i, /\bfreeze\b/i, /\bfrozen\b/i, /\bblue screen\b/i,
  /\brefused\b/i, /\breject\b/i, /\bdenied\b/i, /\bforbidden\b/i,
  /\bexit code\b/i, /\bnot found\b/i, /\bnot defined\b/i, /\bnot a function\b/i,
  /\bcannot\b/i, /\bbroken\b/i, /\bleak\b/i,
  // 异常类型（具体异常名）
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|NullPointerException|NullReferenceException|IllegalArgumentException|IllegalStateException|RuntimeException|ConcurrentModificationException|IOException|SQLException)\b/,
  // 新手友好标签（用于搜 issue）
  /\b(good first issue|help wanted|beginner friendly|beginner-friendly|up for grabs|first timers only)\b/i,
]

// PROBLEM_INDICATOR：问题指示词（中等强度，优先于 code general，但不优先于 code API）
// "bug" 出现说明有问题，但 "error" 可能是 "error handling" 代码主题
const PROBLEM_INDICATOR_PATTERNS = [
  /问题|修复|无法|不能|不行|没法|坏了|出错|卡住|延迟|拦截|重启|冲突/,
  /\bbug\b/i, /\bfix\b/i, /\bissue\b/i, /\bproblem\b/i, /\bfail\b/i,
  /\bundefined\b/i, /\bnot working\b/i, /\btimeout\b/i, /\binvalid\b/i,
]

// WEAK_ISSUE：弱 issue 信号（可能是代码主题，如 error handling）
const WEAK_ISSUE_PATTERNS = [
  /错误|异常/,
  /\berror\b/i, /\bexception\b/i,
]

// Code API 强信号：点号调用（Promise.all, Array.map, torch.nn 等）
// 优先级在 ACTUAL_ERROR 之后（"Promise.all 报错" → issue）
const CODE_API_STRONG_PATTERNS = [
  // JS 内置对象的点号调用
  /\b(Array|Object|JSON|Math|Date|String|Number|Boolean|Map|Set|Promise|Reflect|Proxy)\.\w+/,
  // console.log / System.out 等
  /\bconsole\.(log|error|warn|info|debug)\b/i,
  /\bSystem\.out\./,
  // 通用点号调用：tensor.reshape, torch.nn, transformers.pipeline 等
  // 要求点号两侧各至少 2 个字母，避免匹配版本号（3.10）或缩写（e.g.）
  /\b[a-zA-Z]{2,}\.[a-zA-Z]{2,}/,
]

// Code 技术配置模式：框架/库名 + 配置/动作词 → code
// 让 "Redux Toolkit 配置" "Vue3 Composition API" "Django ORM 查询优化" 等判为 code
const TECH_NAMES = /\b(Redux|Toolkit|Vite|Webpack|Tailwind|FastAPI|Express|Django|gRPC|Redis|Kafka|Next\.js|Nuxt\.js|Spring Boot|Vue\d?|React)\b/i
const CODE_CONFIG_WORDS = /配置|优化|实现|路由|主题|顺序|缓存|federation|middleware|ORM|调用|消费者组|分布式锁|alias|config|setup|自定义|异步|流式/
const CODE_TECH_API_PATTERNS = [
  /\b(Composition API|REST API|Web API|GraphQL API)\b/i,
  // 框架 + 配置/动作词
  new RegExp('(' + TECH_NAMES.source + ').*(' + CODE_CONFIG_WORDS.source + ')', 'i'),
  new RegExp('(' + CODE_CONFIG_WORDS.source + ').*(' + TECH_NAMES.source + ')', 'i'),
]

// Code 命令行：npm install, git push, docker compose, kubectl get 等
const CODE_CMD_PATTERNS = [
  /\b(npm|yarn|pnpm|pip|docker|kubectl|cargo|go|brew|apt|yum|helm|terraform|ansible)\s+(install|add|run|build|create|init|start|stop|remove|update|upgrade|apply|exec|pull|push|compose|get|describe|logs|delete|scale|rollout|plan|destroy|fmt|validate|import|playbook|search|list|package|upgrade|rollback|uninstall)\b/i,
  /\bgit\s+(push|pull|clone|commit|add|merge|rebase|checkout|branch|fetch|stash|reset|revert|cherry-pick|tag|diff|log|status)\b/i,
]

// Code 通用：代码关键词、API 名、符号
const CODE_GENERAL_PATTERNS = [
  /\bfunction\b|\bclass\b|\bimport\b|\bexport\b|\bconst\b|\blet\b|\bvar\b|\bdef\b/i,
  /=>|\(\)|::|\.\w+\(/,
  /\buse[A-Z]/, /\bset[A-Z]/, /\bget[A-Z]/,
  /\bPromise\b/i, /\basync\b/i, /\bawait\b/i,
  /\bprint\s*\(/, /\bprintf\s*\(/,
  // 对象方法链调用
  /\.\w+\.\w+\(/,
  // 常见全局函数（不要求括号，匹配函数名即可）
  /\b(fetch|axios|require|setTimeout|setInterval|addEventListener|querySelector|getElementById)\b/,
  // JS 内置对象名（Proxy, Reflect, Symbol 等，即使无点号调用也是 code 信号）
  /\b(Proxy|Reflect|Symbol|Generator|Iterator|WeakMap|WeakSet)\b/,
]

// 仓库路径模式（强信号，覆盖词数规则）
// 要求 owner/repo 格式，且 owner 和 repo 都至少2字符（避免 async/await 误判）
const REPO_PATH_PATTERN = /^[\w][\w.-]*\/[\w][\w.-]*$/

// Repo-like 强信号：复合词组（覆盖词数规则，单独出现即触发）
const REPO_STRONG_PATTERNS = [
  /活跃项目|活跃的?项目|热门项目|优秀项目|推荐项目|高质量项目|明星项目|开源项目/,
  // 英文：句中同时出现形容词和 projects/repos/frameworks/libraries/tools/games 即算 repo
  /\b(active|popular|awesome|best|top|recommended|trending|cool|nice|famous|great|amazing|good)\b.*\b(projects?|repos?|repositories|frameworks?|libraries?|tools?|games?|templates?|starters?|boilerplates?)\b/i,
  /\b(projects?|repos?|repositories|frameworks?|libraries?|tools?|games?|templates?|starters?|boilerplates?)\b.*\b(active|popular|awesome|best|top|recommended|trending|cool|nice|famous|great|amazing|good)\b/i,
  // awesome + 技术名（awesome react, awesome python 等）
  /\bawesome\s+\w+/i,
  // open source + 项目类型
  /\bopen source\b.*\b(games?|projects?|repos?|libraries?|frameworks?|tools?)\b/i,
  /\b(games?|projects?|repos?|libraries?|frameworks?|tools?)\b.*\bopen source\b/i,
]

// Repo 资源词（需要 wordCount >= 2 才触发，避免单字误判）
// 包含：项目/仓库/repo/库/框架/工具/教程/模板/demo 等
const REPO_RESOURCE_PATTERNS = [
  // 通用项目/仓库词
  /项目|仓库/,
  /\brepos?\b/i,
  /\brepositories\b/i,
  // "X 库" / "X 框架" / "X 引擎" / "X 工具" 也算 repo 意图
  // 注意：通过 queryForRepo 保护"数据库"不被"库"误匹配
  /库|框架|引擎|工具/,
  // 资源类词（找教程/模板/架构/数据集/论文/demo/网站/系统/方案等）
  /教程|模板|架构|数据集|论文|demo|网站|大全|系统|方案|规范|指南|手册|文档|资源|合集|精选|清单|列表|面试题|刷题|示例|样例|脚手架|boilerplate|starter|template/,
]

// ===== 中文分词（用于词数统计，判断 < 3 词）=====
const CN_DICT = new Map([
  ['项目', 'keep'], ['仓库', 'keep'], ['活跃', 'keep'], ['开源', 'keep'],
  ['新手', 'keep'], ['入门', 'keep'], ['文档', 'keep'], ['贡献', 'keep'],
  ['教程', 'keep'], ['示例', 'keep'], ['框架', 'keep'], ['工具', 'keep'],
  ['搜索', 'keep'], ['开发', 'keep'], ['学习', 'keep'], ['代码', 'keep'],
  ['编程', 'keep'], ['社区', 'keep'], ['简单', 'keep'], ['快速', 'keep'],
  ['中文', 'keep'], ['汉化', 'keep'],
  ['的', 'stop'], ['了', 'stop'], ['是', 'stop'], ['适合', 'stop'],
  ['推荐', 'stop'], ['帮我', 'stop'], ['什么', 'stop'], ['一个', 'stop'],
  ['怎么', 'stop'], ['如何', 'stop'], ['找', 'stop'], ['请', 'stop'],
  ['一下', 'stop'], ['看看', 'stop'], ['谢谢', 'stop'],
])

const CN_SINGLE_STOP = new Set(['的', '了', '是', '找', '求', '吧', '吗', '呢', '啊', '嘛', '哦', '哈', '呀', '哟'])

/** 中文 FMM 分词，返回 keep 词列表 */
function segmentChinese(text) {
  const words = []
  let i = 0
  while (i < text.length) {
    let matched = null
    for (let len = Math.min(5, text.length - i); len >= 2; len--) {
      const sub = text.slice(i, i + len)
      if (CN_DICT.has(sub)) {
        matched = { word: sub, type: CN_DICT.get(sub), len }
        break
      }
    }
    if (matched) {
      if (matched.type === 'keep') words.push(matched.word)
      i += matched.len
    } else {
      if (!/[，。、！？,.!?；;：:（）()\[\]【】\s]/.test(text[i]) && !CN_SINGLE_STOP.has(text[i])) {
        words.push(text[i])
      }
      i++
    }
  }
  return words
}

/**
 * 词数统计：中英文混合，返回 token 数
 * 用于判断"短于 3 个词"规则
 */
function countWords(query) {
  let separated = query
    .replace(/([a-zA-Z0-9]+)([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/([\u4e00-\u9fa5])([a-zA-Z0-9]+)/g, '$1 $2')
  separated = separated.replace(/[，。、！？,.!?；;：:（）()\[\]【】"''""''·～~#@$%^&*+=|\\/<>]/g, ' ')
  const tokens = separated.split(/\s+/).filter(Boolean)
  let count = 0
  for (const token of tokens) {
    if (/[\u4e00-\u9fa5]/.test(token)) {
      count += segmentChinese(token).length
    } else {
      if (token.length >= 2) count++
    }
  }
  return count
}

// ===== 分类 =====

/**
 * 将用户输入归类为 5 类之一，并给出置信度
 * @param {string} query 用户输入（已 trim）
 * @param {number} wordCount 词数
 * @returns {{ category, confidence }}
 */
// 代码关键词（用于排除误判为仓库路径的斜杠组合，如 async/await）
const CODE_KEYWORDS = /\b(async|await|Promise|function|class|import|export|const|let|var|def|return|if|else|for|while|try|catch|throw)\b/i

function classify(query, wordCount) {
  // 1. 仓库路径（最强信号，覆盖词数规则）
  // 排除代码关键词组合（async/await 等）
  if (REPO_PATH_PATTERN.test(query) && !CODE_KEYWORDS.test(query)) {
    return { category: 'repo-like', confidence: 'high' }
  }

  // 2. QA 概念型（什么是/是什么/为什么/解释 等，任意位置出现）→ QA
  // 优先于一切 issue/code 信号
  // 让 "什么是合并冲突" "为什么 git push 失败" "CONTRIBUTING.md 是什么" → QA
  if (QA_CONCEPT_PATTERNS.some(p => p.test(query))) {
    return { category: 'qa-like', confidence: 'medium' }
  }

  // 3. QA 方法型句首 + ACTUAL_ERROR → issue（用户遇到实际报错，要找解决方案）
  // 让 "请问怎么解决 npm install 时的权限报错问题" → issue
  if (QA_METHOD_LEAD_PATTERNS.some(p => p.test(query)) && ACTUAL_ERROR_PATTERNS.some(p => p.test(query))) {
    return { category: 'issue-like', confidence: 'high' }
  }

  // 4. QA 方法型句首 + 无实际报错 → QA（求知型提问）
  // 让 "怎么解决冲突" "怎么第一次贡献代码" "怎么提 issue 报告 bug" → QA
  if (QA_METHOD_LEAD_PATTERNS.some(p => p.test(query))) {
    return { category: 'qa-like', confidence: 'medium' }
  }

  // 5. QA 句尾（是什么$ / ?$）→ QA（要求至少有实际词汇，避免纯标点 "!!!???" 误判）
  if (wordCount >= 1 && QA_END_PATTERNS.some(p => p.test(query))) {
    return { category: 'qa-like', confidence: 'medium' }
  }

  // 6. QA 对比/选择类（vs/对比/区别/哪个好）→ QA
  // 优先于 code API，让 "Next.js 和 Nuxt.js 对比" "Map vs Set usage" → QA
  if (QA_COMPARISON_PATTERNS.some(p => p.test(query))) {
    return { category: 'qa-like', confidence: 'medium' }
  }

  // 7. QA 学习型（使用教程/使用方法/怎么用）→ QA
  // 优先于 code cmd，让 "git rebase 使用教程" → QA
  if (QA_LEARNING_PATTERNS.some(p => p.test(query))) {
    return { category: 'qa-like', confidence: 'medium' }
  }

  // 8. ACTUAL_ERROR（实际报错词）→ issue
  // 优先于 code API，让 "Promise.all 报错" → issue
  if (ACTUAL_ERROR_PATTERNS.some(p => p.test(query))) {
    return { category: 'issue-like', confidence: 'high' }
  }

  // 9. Code API 强信号（点号调用）→ code
  if (CODE_API_STRONG_PATTERNS.some(p => p.test(query))) {
    return { category: 'code-like', confidence: 'high' }
  }

  // 10. Code 技术配置（框架+配置词 / Composition API 等）→ code
  if (CODE_TECH_API_PATTERNS.some(p => p.test(query))) {
    return { category: 'code-like', confidence: 'high' }
  }

  // 11. PROBLEM_INDICATOR（bug/问题/fix 等）→ issue
  // 优先于 code general，让 "useEffect 无限循环 bug" → issue
  if (PROBLEM_INDICATOR_PATTERNS.some(p => p.test(query))) {
    return { category: 'issue-like', confidence: 'high' }
  }

  // 12. Code 通用（function, async, use[A-Z] 等）→ code
  // 让 "async function error handling" → code（error 是弱 issue，不覆盖 code general）
  if (CODE_GENERAL_PATTERNS.some(p => p.test(query))) {
    return { category: 'code-like', confidence: 'high' }
  }

  // 13. WEAK_ISSUE（error/错误 等弱 issue 信号）→ issue
  if (WEAK_ISSUE_PATTERNS.some(p => p.test(query))) {
    return { category: 'issue-like', confidence: 'high' }
  }

  // 14. QA 通用（怎么办/怎么/如何/吗 等，任意位置出现）→ QA
  // 放在 REPO_STRONG 之前，让 "开源项目怎么维护" "开源许可证怎么选" → QA
  if (wordCount >= 1 && QA_GENERAL_PATTERNS.some(p => p.test(query))) {
    return { category: 'qa-like', confidence: 'medium' }
  }

  // 15. Code 命令行（npm install, git push 等）→ code
  if (CODE_CMD_PATTERNS.some(p => p.test(query))) {
    return { category: 'code-like', confidence: 'high' }
  }

  // 16. Repo 强信号 → repo
  if (REPO_STRONG_PATTERNS.some(p => p.test(query))) {
    return { category: 'repo-like', confidence: 'high' }
  }

  // 17. Repo 资源词（项目/仓库/库/框架/教程/示例 等）
  // 需要 wordCount >= 2，避免 "demo"/"教程" 单字误判为 repo
  // 保护"数据库"不被"库"误匹配
  if (wordCount >= 2) {
    const queryForRepo = query.replace(/数据库/g, '__DB__')
    if (REPO_RESOURCE_PATTERNS.some(p => p.test(queryForRepo))) {
      return { category: 'repo-like', confidence: 'high' }
    }
  }

  // 18. 短查询（< 3 词）→ mixed/unknown
  if (wordCount < 3) {
    return { category: 'mixed/unknown', confidence: 'low' }
  }

  // 默认 mixed
  return { category: 'mixed/unknown', confidence: 'low' }
}

// ===== 选源 =====

/**
 * 根据分类决定搜索哪些来源
 * 原则：意图明确就只搜对应源，不清楚才全搜
 * - repo-like → 只搜 repo
 * - issue-like → 只搜 issue
 * - code-like → 只搜 code
 * - qa-like → knowledge + web
 * - mixed/unknown → 全搜
 */
function selectSources(category, confidence) {
  if (confidence === 'low' || category === 'mixed/unknown') {
    return ['repo', 'issue', 'code', 'knowledge', 'web']
  }
  switch (category) {
    case 'repo-like': return ['repo']
    case 'issue-like': return ['issue']
    case 'code-like': return ['code']
    case 'qa-like': return ['knowledge', 'web']
    default: return ['repo', 'issue', 'code', 'knowledge', 'web']
  }
}

// ===== 查询改写 =====

/**
 * 移除明显无意义的词（please, help me, 请, 帮我 等）
 * 同时移除中文修饰词（适合新手的、活跃项目、推荐、新手、入门等）
 * 这些词在 GitHub 搜索中会变成精确匹配，导致结果极少
 */
function stripNoiseWords(query) {
  return query
    // 英文无意义词
    .replace(/\b(please|help me|can you|could you|the|a|an)\b/gi, '')
    // 中文客套/修饰词
    .replace(/请|帮我|帮忙|一下|看看|谢谢|大家|麻烦|请问|想要|想找|找一下/g, '')
    .replace(/\s+/g, ' ')
    .trim() || query
}

/**
 * 从中文自然语言查询中提取核心关键词
 * 移除修饰性短语（适合新手的、活跃项目、推荐、新手友好等），
 * 只保留技术名词、项目名等核心词
 *
 * 例如：
 *   "适合新手的 React issue" → "React"
 *   "Python 活跃项目" → "Python"
 *   "适合新手的 Python issue" → "Python"
 */
function extractCoreKeywords(query) {
  let result = query
  // 移除中文修饰短语（按长度从长到短，避免部分匹配）
  result = result
    .replace(/适合新手的?|新手友好的?|适合新人的?|新手入门的?|适合初学者的?|适合学习的?/g, '')
    .replace(/活跃项目|活跃的?项目|热门项目|优秀项目|推荐项目|高质量项目|明星项目/g, '')
    .replace(/新手|入门|新人|初学者|小白|菜鸟|零基础/g, '')
    .replace(/推荐|方向|有哪些|有没有|一个|哪个|一些|什么样|啥样|啥|几个|求|级|开源|好用|大佬|帮忙|求助|跪|任务|个|种|条|本|篇|要|好|最好|详细|那种|这种/g, '')
    .replace(/贡献|参与|第一次|首次/g, '')
    // 中文尺寸/修饰词（GitHub 不理解，移除以免污染搜索）
    .replace(/小型|微型|大型|中型|轻量|迷你|简单|复杂|经典|优秀|牛逼|厉害/g, '')
    // 中文时间词（GitHub 搜索语法不支持，移除）
    // 注意：与 extractFiltersFromQuery 的时间词保持一致，避免残留污染搜索词
    .replace(/最近一年|一年内|过去一年|最近半年|半年内|过去半年|最近三个月|三个月内|最近|近期|最新|今年|去年|近期更新|活跃|一年的?|半年|三个月|一个月|几个月/g, '')
    // 中文量词/泛词（保护"数据库"等复合词，先移除完整词再移除单字）
    // 注意："引擎"保留（是重要搜索词，如"游戏引擎"）
    .replace(/仓库|项目|代码|教程|示例|例子|案例|资源|合集|集合|清单|列表|框架|工具/g, '')
    // 移除孤立的"库"（但保护"数据库"——上面已移除"工具"等，这里"数据库"的"库"会被移除，需要特殊处理）
    .replace(/数据库/g, '__DB__')
    .replace(/库/g, '')
    .replace(/__DB__/g, '数据库')
    // 中文口语词
    .replace(/我想|我要|我需要|我想要|帮我|麻烦|请问|想要|想找|找一下|找点|看看|谢谢|找|给|上|去/g, '')
    // 中文数字+量词（star 一万以上、5k 以上等）
    .replace(/[0-9]+\s*[万千百千kK]+\s*以上|以上|以下|超过|不到|大约|大概|左右/g, '')
    // 移除 star/收藏/点赞 等指标词（用边界匹配，避免破坏 starter等词）
    .replace(/\bstars?\b/gi, '')
    .replace(/收藏|点赞|加星|星标/g, '')
    // 移除残留的"万以""千以"等
    .replace(/[万千百kK]+以/g, '')
    // 移除残留的孤立数字（一万→一、5k→5）
    // 保护常见带数字的缩写（e2e, b2b, o2o, i18n, l10n, a11y, k8s, w3c 等）
    .replace(/\b(e2e|b2b|o2o|i18n|l10n|a11y|k8s|w3c|b2c|c2c|p2p|s3|ec2|r2)\b/gi, m => '__' + m.toUpperCase() + '__')
    .replace(/[0-9]+|[一二三四五六七八九十]+/g, '')
    .replace(/__(E2E|B2B|O2O|I18N|L10N|A11Y|K8S|W3C|B2C|C2C|P2P|S3|EC2|R2)__/g, m => m.toLowerCase().replace(/__/g, ''))
    // 移除版本号残留的孤立点（python 3.10 → python . → python）
    .replace(/^\s*\.\s*|\s*\.\s*$|\s*\.\s+(?=\s)/g, ' ')
    // 移除"的"等孤立助词（"中"保留，可能是"中文"等词的一部分）
    .replace(/的|了|是|在|上|下|为|不|没|无/g, '')
    // 移除孤立的"小"（尺寸词残留，"大""中"可能是有意义词的一部分）
    .replace(/小/g, '')
    // 移除英文修饰词
    .replace(/\b(good first issue|gfi|beginner|newcomer|starter|easy|simple)\b/gi, '')
    .replace(/\b(active|popular|awesome|best|top|recommended|trending|famous|cool|nice)\b/gi, '')
    .replace(/\b(small|tiny|large|big|medium|lightweight|mini)\b/gi, '')
    .replace(/\bproject|projects|repositories|repository|repo|tutorial|example|sample\b/gi, '')
    // 移除残留的孤立单字母（只移除英文冠词等无意义单字母，保留 c/r 等技术名）
    .replace(/\b(a|an|s)\b/gi, '')
    // 移除孤立的 "issue" 词（避免把整句当字面搜索）
    .replace(/\bissues?\b/gi, '')
    // 清理多余空格和括号
    .replace(/[（）()【】\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // 如果清理后为空，返回空字符串（调用方用 cleanQuery 兜底）
  return result
}

/** 移除 QA 引导词（什么是, how to, why 等）— 仅用于 repo/issue/code 查询 */
function stripQaLeadWords(query) {
  return query
    .replace(/什么是|是什么|什么叫|怎么理解|如何理解|为什么|为何|为啥|区别|怎样|怎么办|怎么做/g, '')
    .replace(/\b(what is|how to|why|explain|difference between|what does|how do|how does)\b/gi, '')
    .replace(/[?？]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || query
}

/**
 * 为每个来源生成查询词
 * - knowledge/web：保留自然语言（适合问答）
 * - repo/issue/code：提取核心关键词 + 移除 QA 引导词和无意义词
 *   核心关键词提取是关键 — 整句传给 GitHub 会做精确匹配，结果极少
 */
function rewriteForAllSources(rawQuery) {
  const result = {}
  for (const src of ['repo', 'issue', 'code', 'knowledge', 'web']) {
    if (src === 'knowledge' || src === 'web') {
      // knowledge/web 保留自然语言，只移除无意义词
      result[src] = stripNoiseWords(rawQuery)
    } else {
      // repo/issue/code 提取核心关键词，移除修饰词和 QA 引导词
      const cleaned = stripNoiseWords(stripQaLeadWords(extractCoreKeywords(rawQuery)))
      // 清理后为空时用 stripNoiseWords(rawQuery) 兜底（保证不丢查询）
      result[src] = cleaned || stripNoiseWords(rawQuery)
    }
  }
  return result
}

// ===== 从自然语言提取过滤条件 =====

/**
 * 从中文自然语言查询中提取结构化过滤条件
 * 让 "小型python仓库" → { maxStars: 1000 } 等
 * 与 extractCoreKeywords 配合：extractCoreKeywords 移除修饰词，这里提取为过滤条件
 *
 * @param {string} query 用户原始输入
 * @returns {object} 过滤条件对象（空对象表示无提取）
 */
function extractFiltersFromQuery(query) {
  const filters = {}

  // 尺寸词 → stars 范围
  // 注意：中型(1000-5000)与大型(5000+)衔接，避免 5000-50000 重叠区间
  if (/小型|微型|轻量|迷你|小项目/.test(query)) {
    filters.maxStars = 1000
  } else if (/中型/.test(query)) {
    filters.minStars = 1000
    filters.maxStars = 5000
  } else if (/大型|大项目/.test(query)) {
    filters.minStars = 5000
  }

  // 明确的 star 数量
  // "star 一万以上" "1万以上" "过万" "5k以上"
  // 支持中文数字（一二三四五六七八九十）
  const cnNumMap = { '一':1, '二':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9, '十':10 }
  const parseCnNum = (s) => {
    const n = parseInt(s)
    if (!isNaN(n)) return n
    return cnNumMap[s] || 0
  }
  const starMatch = query.match(/(?:star|★|星)\s*([0-9一二三四五六七八九十]+)\s*[万千kK]?\s*以上/) ||
                    query.match(/([0-9一二三四五六七八九十]+)\s*[万千kK]\s*以上/)
  if (starMatch) {
    let n = parseCnNum(starMatch[1])
    if (/万/.test(starMatch[0])) n *= 10000
    else if (/千|k|K/.test(starMatch[0])) n *= 1000
    if (n > 0) filters.minStars = n
  }
  // "5k以上" "5000以上"（纯数字+以上，无"万/千/k"单位）
  const starNumMatch = query.match(/([0-9]+)\s*以上/)
  if (starNumMatch && !filters.minStars) {
    filters.minStars = parseInt(starNumMatch[1])
  }

  // 时间词 → createdAfter / updatedAfter
  const now = new Date()
  const monthsAgo = (m) => {
    const d = new Date(now)
    d.setMonth(d.getMonth() - m)
    return d.toISOString().slice(0, 10)
  }

  if (/最近一年|一年内|过去一年/.test(query)) {
    filters.createdAfter = monthsAgo(12)
  } else if (/最近半年|半年内|过去半年/.test(query)) {
    filters.createdAfter = monthsAgo(6)
  } else if (/最近三个月|三个月内/.test(query)) {
    filters.createdAfter = monthsAgo(3)
  } else if (/今年/.test(query)) {
    filters.createdAfter = `${now.getFullYear()}-01-01`
  }

  // 活跃度 → updatedAfter
  if (/活跃|近期更新|最近更新/.test(query)) {
    filters.updatedAfter = monthsAgo(1)
  }

  // 排序
  if (/最新/.test(query)) {
    filters.sort = 'updated'
  } else if (/最热|热门|最多star|star最多/.test(query)) {
    filters.sort = 'stars'
  }

  return filters
}

// ===== 主入口 =====

/**
 * 路由查询 — 生成搜索计划
 * @param {string} rawQuery 用户原始输入
 * @returns {{
 *   confidence: 'high'|'medium'|'low',
 *   category: 'repo-like'|'issue-like'|'code-like'|'qa-like'|'mixed/unknown',
 *   sources: string[],
 *   query_by_source: { repo, issue, code, knowledge, web },
 *   filters: object,
 *   fallback: 'show_all'|'narrow'|'ask_none',
 *   reason: string,
 *   intent: string  // UI 兼容：repo|issue|code|qa|mixed
 * }}
 */
/**
 * 为 detectChineseIntent 构造 query_by_source
 *
 * GitHub 源（issue/repo/code）直接用 expandedQuery（已含 GitHub 搜索语法如 OR、标签词），
 * 不走 extractCoreKeywords —— extractCoreKeywords 会移除 "wanted"/"friendly"/"good first issue" 等词，
 * 破坏 detectChineseIntent 构造的 OR 语法和标签词，导致搜索结果为 0。
 *
 * knowledge/web 用原自然语言 query（适合问答检索）。
 */
function buildIntentQueryBySource(githubQuery, naturalQuery) {
  return {
    issue: githubQuery,
    repo: githubQuery,
    code: githubQuery,
    knowledge: naturalQuery,
    web: naturalQuery,
  }
}

// ===== 两阶段意图识别：对象类型 + 属性（重构 P3）=====
// 核心思想：属性词（简单/新手/活跃）只修饰类别，不决定类别
// Stage 1 判断"搜什么"（repo/issue/code/knowledge），Stage 2 提取"怎么搜"（filters/sort）

/**
 * 对象词表 — 决定搜索类别（Stage 1）
 * 只包含明确的"对象名词"和"动作动词"，属性词（简单/新手/活跃）不参与
 */
const OBJECT_KEYWORDS = {
  repo: [
    '项目', '仓库', '工程', '框架', '库', 'demo', '示例', '脚手架', 'boilerplate',
    'starter', 'template', 'project', 'repo', 'repository', 'repositories',
  ],
  issue: [
    'issue', '问题', 'bug', '任务', '认领', '修复', '解决', '工单', '缺陷',
  ],
  code: [
    '代码', '函数', '方法', '实现', '源码', 'code', 'function', 'implementation',
    'snippet', '源代码',
  ],
  knowledge: [
    '是什么', '为什么', '原理', '概念', '教程', '怎么用', '文档', '区别',
    '含义', '意思', 'what is', 'why', 'how does', 'tutorial', 'docs',
  ],
}

/**
 * 属性词表 — 只修饰类别，不决定类别（Stage 2）
 * 每个属性维度有多个取值，取值映射到 filters/sort
 */
const ATTRIBUTE_KEYWORDS = {
  // 复杂度
  complexity: {
    simple: ['简单', '容易', '轻量', '小巧', '小型', '入门级', 'minimal', 'lightweight', 'easy'],
    complex: ['复杂', '大型', '企业级', '重量级', 'heavy', 'enterprise', '复杂度'],
  },
  // 新手友好度
  beginner: {
    yes: ['新手', '入门', '零基础', '小白', '初学者', '菜鸟', 'beginner', 'newcomer', 'starter'],
  },
  // 活跃度
  activity: {
    active: ['活跃', '维护中', '最近更新', '近期更新', 'active', 'maintained'],
    dead: ['废弃', '停更', 'dead', 'archived', 'unmaintained'],
  },
  // 质量
  quality: {
    high: ['优秀', '高质量', '明星', '热门', '推荐', 'popular', 'trending', 'awesome', 'best', 'top'],
  },
}

/**
 * Stage 1: 检测对象类型（只看对象词，不看属性词）
 * @param {string} query
 * @returns {{type: 'repo'|'issue'|'code'|'knowledge'|null, matchedWord: string|null}}
 */
function detectObject(query) {
  const q = query.toLowerCase()
  // 按优先级检查：knowledge > issue > code > repo
  // knowledge 优先因为有"是什么/为什么"等强信号
  for (const kw of OBJECT_KEYWORDS.knowledge) {
    if (q.includes(kw.toLowerCase())) return { type: 'knowledge', matchedWord: kw }
  }
  // issue：检查"问题/bug/issue/任务"等
  for (const kw of OBJECT_KEYWORDS.issue) {
    if (q.includes(kw.toLowerCase())) return { type: 'issue', matchedWord: kw }
  }
  // code：检查"代码/函数/实现"等
  for (const kw of OBJECT_KEYWORDS.code) {
    if (q.includes(kw.toLowerCase())) return { type: 'code', matchedWord: kw }
  }
  // repo：检查"项目/仓库/框架"等
  for (const kw of OBJECT_KEYWORDS.repo) {
    if (q.includes(kw.toLowerCase())) return { type: 'repo', matchedWord: kw }
  }
  return { type: null, matchedWord: null }
}

/**
 * Stage 2: 提取属性（独立于对象类型）
 * @param {string} query
 * @returns {{complexity?: 'simple'|'complex', beginner?: boolean, activity?: 'active'|'dead', quality?: 'high'}}
 */
function extractAttributes(query) {
  const q = query.toLowerCase()
  const attrs = {}

  // 复杂度
  for (const w of ATTRIBUTE_KEYWORDS.complexity.simple) {
    if (q.includes(w.toLowerCase())) { attrs.complexity = 'simple'; break }
  }
  if (!attrs.complexity) {
    for (const w of ATTRIBUTE_KEYWORDS.complexity.complex) {
      if (q.includes(w.toLowerCase())) { attrs.complexity = 'complex'; break }
    }
  }

  // 新手友好度
  for (const w of ATTRIBUTE_KEYWORDS.beginner.yes) {
    if (q.includes(w.toLowerCase())) { attrs.beginner = true; break }
  }

  // 活跃度
  for (const w of ATTRIBUTE_KEYWORDS.activity.active) {
    if (q.includes(w.toLowerCase())) { attrs.activity = 'active'; break }
  }
  if (!attrs.activity) {
    for (const w of ATTRIBUTE_KEYWORDS.activity.dead) {
      if (q.includes(w.toLowerCase())) { attrs.activity = 'dead'; break }
    }
  }

  // 质量
  for (const w of ATTRIBUTE_KEYWORDS.quality.high) {
    if (q.includes(w.toLowerCase())) { attrs.quality = 'high'; break }
  }

  return attrs
}

/**
 * Stage 3: 合并对象类型 + 属性 → 搜索计划
 * @param {string} query
 * @returns {object|null} routeQuery 返回结构，或 null（无对象词，交给 L1）
 */
function detectChineseIntentV2(query) {
  const { type, matchedWord } = detectObject(query)
  const attrs = extractAttributes(query)
  const techTerm = extractTechTerm(query)

  // 无对象词 → 不处理，交给 L1 通用规则
  if (!type) return null

  // 根据对象类型 + 属性组合搜索计划
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  // ===== knowledge 对象（教程/原理/是什么）=====
  if (type === 'knowledge') {
    // 教程类 + 新手 → knowledge + code + repo
    if (matchedWord === '教程' || matchedWord === 'tutorial' || matchedWord === '怎么用') {
      const expandedQuery = techTerm ? `${techTerm} tutorial OR example OR demo` : 'tutorial OR example OR demo'
      return {
        confidence: 'high',
        category: 'qa-like',
        sources: ['knowledge', 'code', 'repo'],
        query_by_source: buildIntentQueryBySource(expandedQuery, query),
        filters: {},
        fallback: 'show_all',
        reason: `识别到教程意图（${matchedWord}），搜索知识库+代码+仓库`,
        intent: 'qa',
        subIntent: 'tutorial',
      }
    }
    // 概念类 → knowledge + web
    return {
      confidence: 'high',
      category: 'qa-like',
      sources: ['knowledge', 'web'],
      query_by_source: buildIntentQueryBySource(query, query),
      filters: {},
      fallback: 'show_all',
      reason: `识别到概念提问（${matchedWord}），优先搜索知识库`,
      intent: 'qa',
      subIntent: 'concept',
    }
  }

  // ===== issue 对象（bug/问题/任务）=====
  if (type === 'issue') {
    // 报错类 → issue + code + knowledge
    if (/报错|修复|怎么解决|bug|异常|崩溃|error|exception|fix|crash|失败|不工作|无法|不能/i.test(query)) {
      const expandedQuery = techTerm ? `${techTerm} error OR bug OR exception` : 'error OR bug OR exception'
      return {
        confidence: 'high',
        category: 'issue-like',
        sources: ['issue', 'code', 'knowledge'],
        query_by_source: buildIntentQueryBySource(expandedQuery, query),
        filters: {},
        fallback: 'narrow',
        reason: `识别到报错/修复意图（${matchedWord}），搜索 issue+代码+知识库`,
        intent: 'issue',
        subIntent: 'error',
      }
    }
    // 新手 + issue → good first issue 扩词
    if (attrs.beginner) {
      const expandedQuery = techTerm
        ? `${techTerm} good first issue OR help wanted OR beginner friendly OR "first contribution"`
        : 'good first issue OR help wanted OR beginner friendly'
      return {
        confidence: 'high',
        category: 'issue-like',
        sources: ['issue'],
        query_by_source: buildIntentQueryBySource(expandedQuery, query),
        filters: {},
        fallback: 'narrow',
        reason: `识别到新手 issue 意图（${matchedWord}+新手），扩词到 good first issue`,
        intent: 'issue',
        subIntent: 'beginner',
      }
    }
    // 普通 issue
    const expandedQuery = techTerm || query
    return {
      confidence: 'high',
      category: 'issue-like',
      sources: ['issue'],
      query_by_source: buildIntentQueryBySource(expandedQuery, query),
      filters: {},
      fallback: 'narrow',
      reason: `识别到 issue 意图（${matchedWord}），搜索 issue`,
      intent: 'issue',
    }
  }

  // ===== code 对象（代码/函数/实现）=====
  if (type === 'code') {
    const expandedQuery = techTerm || query
    return {
      confidence: 'high',
      category: 'code-like',
      sources: ['code'],
      query_by_source: buildIntentQueryBySource(expandedQuery, query),
      filters: {},
      fallback: 'narrow',
      reason: `识别到代码意图（${matchedWord}），搜索代码`,
      intent: 'code',
    }
  }

  // ===== repo 对象（项目/仓库/框架）=====
  if (type === 'repo') {
    const filters = {}
    let sortHint = ''

    // 应用属性到 filters
    if (attrs.complexity === 'simple') {
      filters.minStars = 5  // 简单项目 → 低门槛
      sortHint = 'stars'
    } else if (attrs.complexity === 'complex') {
      filters.minStars = 1000  // 复杂项目 → 高 star
    }
    if (attrs.beginner) {
      filters.minStars = Math.min(filters.minStars || 10, 200)  // 新手项目 → 小项目易理解
    }
    if (attrs.activity === 'active') {
      filters.updatedAfter = monthAgo
      filters.minStars = Math.max(filters.minStars || 0, 100)
    }
    if (attrs.quality === 'high') {
      filters.minStars = Math.max(filters.minStars || 0, 1000)
      sortHint = 'stars'
    }

    const expandedQuery = techTerm
      ? (attrs.quality === 'high' ? `${techTerm} stars:>${filters.minStars || 100}` : techTerm)
      : (attrs.quality === 'high' ? `stars:>${filters.minStars || 100}` : query)

    const reasonParts = [`识别到项目意图（${matchedWord}）`]
    if (attrs.complexity === 'simple') reasonParts.push('简单/轻量')
    if (attrs.beginner) reasonParts.push('新手友好')
    if (attrs.activity === 'active') reasonParts.push('活跃维护')
    if (attrs.quality === 'high') reasonParts.push('高质量')

    return {
      confidence: 'high',
      category: 'repo-like',
      sources: ['repo'],
      query_by_source: buildIntentQueryBySource(expandedQuery, query),
      filters,
      fallback: 'show_all',
      reason: reasonParts.join(' + '),
      intent: 'repo',
      subIntent: 'discovery',
    }
  }

  return null
}

/**
 * 中文意图词专门识别（生产标准改造 P1-5/6，P3 重构为两阶段流水线）
 *
 * 两阶段决策：
 *   Stage 1: detectObject() — 只看对象词（项目/issue/代码/教程）决定类别
 *   Stage 2: extractAttributes() — 提取属性（简单/新手/活跃/质量）只修饰 filters
 *   Stage 3: 合并 → 搜索计划
 *
 * 核心改变：属性词不再直接决定类别
 *   - "简单的项目" → object=repo + complexity=simple → 搜小项目
 *   - "新手 issue" → object=issue + beginner=yes → 搜 good first issue
 *
 * @param {string} query
 * @returns {object|null} routeQuery 返回结构，或 null（无对象词，交给 L1）
 */
function detectChineseIntent(query) {
  return detectChineseIntentV2(query)
}

/**
 * 从中文 query 中提取技术词（移除中文修饰词后剩下的英文/技术词）
 * 用于扩词时保留核心技术词
 * @param {string} query
 * @returns {string}
 */
function extractTechTerm(query) {
  // 移除中文修饰词，保留英文/技术词
  let result = query
    .replace(/适合新手的?|新手友好的?|适合新人的?|新手入门的?|适合初学者的?|适合学习的?/g, '')
    .replace(/活跃项目|活跃的?项目|热门项目|优秀项目|推荐项目|高质量项目|明星项目/g, '')
    .replace(/新手|入门|新人|初学者|小白|菜鸟|零基础/g, '')
    .replace(/推荐|方向|有哪些|有没有|一个|哪个|一些|什么样|啥样|啥|几个|求|级|开源|好用|大佬|帮忙|求助|跪|任务/g, '')
    .replace(/贡献|参与|第一次|首次/g, '')
    .replace(/小型|微型|大型|中型|轻量|迷你|简单|复杂|经典|优秀|牛逼|厉害/g, '')
    .replace(/最近一年|一年内|过去一年|最近半年|半年内|过去半年|最近三个月|三个月内|最近|近期|最新|今年|去年|近期更新|活跃|一年的?|半年|三个月|一个月|几个月/g, '')
    .replace(/仓库|项目|代码|教程|示例|例子|案例|资源|合集|集合|清单|列表|框架|工具/g, '')
    .replace(/报错|修复|解决|bug|异常|崩溃|失败|不工作|无法|不能/g, '')
    .replace(/是什么|什么是|为什么|原因是|原理|概念|区别|含义|意思/g, '')
    .replace(/怎么用|如何使用|怎么使用|教程|示例|demo|用法/g, '')
    .replace(/我想|我要|我需要|我想要|帮我|麻烦|请问|想要|想找|找一下|找点|看看|谢谢|找|给|上|去/g, '')
    .replace(/的|了|是|在|上|下|为|不|没|无/g, ' ')
    .replace(/\b(good first issue|gfi|beginner|newcomer|starter|easy|simple|active|popular|awesome|best|top|recommended|trending|famous|cool|nice|help wanted|first contribution|friendly)\b/gi, '')
    .replace(/\b(small|tiny|large|big|medium|lightweight|mini|project|projects|repositories|repository|repo|tutorial|example|sample|error|bug|exception|crash|fix)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return result
}

export function routeQuery(rawQuery) {
  const trimmed = rawQuery.trim()

  // Step 0: 提取过滤条件（尺寸/时间/排序等）
  const extractedFilters = extractFiltersFromQuery(trimmed)

  // Step 0.5: 中文意图词专门识别（生产标准改造 P1-5/6）
  // 对"新手/入门/简单/活跃/维护中/报错/教程/是什么"等中文意图词做专门路由 + 扩词
  const cnIntent = detectChineseIntent(trimmed)
  if (cnIntent) {
    return cnIntent
  }

  // Step 1: bang 前缀（确定性，high confidence）
  const bangEntry = Object.entries(BANG_MAP).find(([bang]) =>
    trimmed.toLowerCase().startsWith(bang)
  )
  if (bangEntry) {
    const rest = trimmed.slice(bangEntry[0].length).trim()
    const query = rest || trimmed
    const intent = bangEntry[1]
    const category = intent === 'repo' ? 'repo-like'
      : intent === 'issue' ? 'issue-like'
      : intent === 'code' ? 'code-like'
      : 'qa-like'
    return {
      confidence: 'high',
      category,
      sources: selectSources(category, 'high'),
      query_by_source: rewriteForAllSources(query),
      filters: extractedFilters,
      fallback: 'narrow',
      reason: `用户使用 ${bangEntry[0]} 前缀明确指定搜索${INTENT_LABELS[intent]}`,
      intent,
    }
  }

  // Step 2: 词数统计
  const wordCount = countWords(trimmed)

  // Step 3: 分类
  const { category, confidence } = classify(trimmed, wordCount)

  // Step 4: 选源
  const sources = selectSources(category, confidence)

  // Step 5: 改写
  const query_by_source = rewriteForAllSources(trimmed)

  // Step 6: fallback
  const fallback = (confidence === 'low' || category === 'mixed/unknown' || category === 'qa-like')
    ? 'show_all' : 'narrow'

  return {
    confidence,
    category,
    sources,
    query_by_source,
    filters: extractedFilters,
    fallback,
    reason: buildReason(category, confidence),
    intent: categoryToIntent(category),
  }
}

function buildReason(category, confidence) {
  if (category === 'mixed/unknown') return '短词或歧义大，不能安全收窄，全搜'
  if (confidence === 'low') return '意图模糊，全搜保证召回'
  if (category === 'repo-like') return '像仓库名/项目名，优先搜索仓库并联动 issue/code'
  if (category === 'issue-like') return '像报错/bug，优先搜索 issue 和代码'
  if (category === 'code-like') return '包含代码/API 特征，优先搜索代码和 issue'
  if (category === 'qa-like') return '像提问，优先知识和网页，保留其它源兜底'
  return '默认全搜'
}

// ===== UI 兼容 =====

export const INTENT_LABELS = {
  repo: '仓库搜索',
  issue: 'Issue 搜索',
  code: '代码搜索',
  qa: '知识问答',
  mixed: '综合搜索',
}

export function categoryToIntent(category) {
  return {
    'repo-like': 'repo',
    'issue-like': 'issue',
    'code-like': 'code',
    'qa-like': 'qa',
    'mixed/unknown': 'mixed',
  }[category] || 'mixed'
}

/**
 * LLM 增强入口（可选）
 * LLM 不可用时返回 null，调用方降级到 routeQuery 结果
 */
export async function enhanceWithLLM(rawQuery, ruleIntent, enhance) {
  const result = await enhance('search.intent', { query: rawQuery, ruleIntent })
  if (!result) return null
  try {
    const parsed = JSON.parse(result)
    return {
      query: parsed.query || rawQuery,
      intent: INTENT_LABELS[parsed.intent] ? parsed.intent : ruleIntent,
    }
  } catch (err) {
    console.warn('[intent] LLM 意图分析失败:', err.message)
    return null
  }
}

/**
 * 将 LLM 返回的意图转为搜索计划覆盖字段
 * 智能模式调用 LLM analyzeIntent 后，用此函数生成 plan 覆盖
 *
 * 生产标准改造（P0-3）：
 *   - 信任 LLM 的 sources 字段（L3 现在输出 8 字段结构）
 *   - ambiguous=true 或 showAll=true 时强制全源宽搜（不覆盖 L1 的 fallback=show_all）
 *   - confidence < 0.6 时降级为 mixed 全搜（不信任 LLM 判断）
 *   - llmIntent.sources 只能收窄 L1 的全源，不能扩展（防 LLM 幻觉）
 *
 * @param {{ intent: string, queryRewrite?: string, rewrittenQuery?: string, sources?: string[], filters?: object, confidence?: number, ambiguous?: boolean, showAll?: boolean, subIntent?: string, expandedTerms?: string[] }} llmIntent
 * @param {string} cleanQuery
 * @returns {{ intent: string, sources: string[], query_by_source: object, llmFilters?: object, subIntent?: string, expandedTerms?: string[] }}
 */
export function applyLLMIntent(llmIntent, cleanQuery) {
  // 兼容新旧字段名
  const queryRewrite = llmIntent.queryRewrite || llmIntent.rewrittenQuery || cleanQuery
  const confidence = typeof llmIntent.confidence === 'number' ? llmIntent.confidence : 0.5
  const ambiguous = llmIntent.ambiguous === true
  const showAll = llmIntent.showAll === true || ambiguous

  // 置信度低 → 降级为 mixed 全搜（不覆盖 L1 宽搜）
  if (confidence < 0.6 || ambiguous) {
    return {
      intent: 'mixed',
      sources: ['repo', 'issue', 'code', 'knowledge', 'web'],
      query_by_source: rewriteForAllSources(queryRewrite || cleanQuery),
      llmFilters: llmIntent.filters || null,
      subIntent: llmIntent.subIntent || null,
      expandedTerms: llmIntent.expandedTerms || [],
    }
  }

  // 高置信度：信任 LLM 的 sources 字段（如果有），否则按 intent 推导
  let sources = Array.isArray(llmIntent.sources) && llmIntent.sources.length > 0
    ? llmIntent.sources
    : selectSourcesByIntent(llmIntent.intent)

  // showAll=true 时强制全源（即使 intent 明确）
  if (showAll) {
    sources = ['repo', 'issue', 'code', 'knowledge', 'web']
  }

  return {
    intent: llmIntent.intent,
    sources,
    query_by_source: rewriteForAllSources(queryRewrite),
    llmFilters: llmIntent.filters || null,
    subIntent: llmIntent.subIntent || null,
    expandedTerms: llmIntent.expandedTerms || [],
  }
}

/**
 * 按 intent 推导 sources（不依赖 confidence）
 * 与 selectSources 不同，这里只看 intent，不强制收窄
 */
function selectSourcesByIntent(intent) {
  switch (intent) {
    case 'repo': return ['repo']
    case 'issue': return ['issue']
    case 'code': return ['code']
    case 'qa': return ['knowledge', 'web']
    default: return ['repo', 'issue', 'code', 'knowledge', 'web']
  }
}
