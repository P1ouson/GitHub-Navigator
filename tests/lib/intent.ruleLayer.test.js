/**
 * 规则层压力测试 — 20轮 × 20用例 = 400 个自然语言输入
 *
 * 目标：系统性地找出规则层的漏网之鱼
 * 覆盖：中英文、边界词组合、填充词残留、意图误判、关键词提取错误
 */
import { describe, it, expect } from 'vitest'
import { routeQuery } from '../../src/lib/intent.js'

// ===== 辅助函数 =====

function checkIntent(plan, expectedIntent, query) {
  const ok = plan.intent === expectedIntent
  if (!ok) {
    console.warn(`  [意图错误] "${query}" → intent=${plan.intent}, 期望=${expectedIntent}`)
  }
  return ok
}

function checkSources(plan, expectedSources, query) {
  const missing = expectedSources.filter(s => !plan.sources.includes(s))
  const extra = plan.sources.filter(s => !expectedSources.includes(s))
  if (missing.length || extra.length) {
    console.warn(`  [源错误] "${query}" → sources=[${plan.sources}], 期望=[${expectedSources}], 缺失=[${missing}], 多余=[${extra}]`)
  }
  return missing.length === 0 && extra.length === 0
}

function checkQueryClean(plan, source, forbiddenWords, query) {
  const q = plan.query_by_source?.[source] || ''
  const found = forbiddenWords.filter(w => q.includes(w))
  if (found.length) {
    console.warn(`  [残留词] "${query}" → ${source}查询="${q}", 残留=[${found}]`)
  }
  return found.length === 0
}

function checkQueryContains(plan, source, requiredWords, query) {
  const q = plan.query_by_source?.[source] || ''
  const missing = requiredWords.filter(w => !q.includes(w))
  if (missing.length) {
    console.warn(`  [缺失词] "${query}" → ${source}查询="${q}", 缺失=[${missing}]`)
  }
  return missing.length === 0
}

// ===== 20 轮测试 =====

describe('规则层压力测试', () => {

  // ============================================================
  // 第 1 轮：中文仓库搜索 + 填充词
  // ============================================================
  describe('第1轮：中文仓库搜索 + 填充词', () => {
    const cases = [
      { q: '图像处理相关的仓库', intent: 'repo', forbidRepo: ['相关', '的', '仓库'], requireRepo: ['图像处理'] },
      { q: '自然语言处理相关的项目', intent: 'repo', forbidRepo: ['相关', '的', '项目'], requireRepo: ['自然语言处理'] },
      { q: '机器学习相关的开源项目', intent: 'repo', forbidRepo: ['相关', '的', '开源', '项目'], requireRepo: ['机器学习'] },
      { q: '后端开发相关的框架', intent: 'repo', forbidRepo: ['相关', '的', '框架'], requireRepo: ['后端开发'] },
      { q: '前端相关的工具库', intent: 'repo', forbidRepo: ['相关', '的', '工具', '库'], requireRepo: ['前端'] },
      { q: '数据分析相关的python库', intent: 'repo', forbidRepo: ['相关', '的', '库'], requireRepo: ['数据分析', 'python'] },
      { q: '游戏开发相关的引擎', intent: 'repo', forbidRepo: ['相关', '的'], requireRepo: ['游戏开发'] },
      { q: '区块链相关的开源仓库', intent: 'repo', forbidRepo: ['相关', '的', '开源', '仓库'], requireRepo: ['区块链'] },
      { q: '深度学习相关的项目推荐', intent: 'repo', forbidRepo: ['相关', '的', '推荐', '项目'], requireRepo: ['深度学习'] },
      { q: '微服务相关的框架有哪些', intent: 'repo', forbidRepo: ['相关', '的', '有哪些', '框架'], requireRepo: ['微服务'] },
      { q: '爬虫相关的好用的工具', intent: 'repo', forbidRepo: ['相关', '的', '好用', '工具'], requireRepo: ['爬虫'] },
      { q: '音视频处理相关的库', intent: 'repo', forbidRepo: ['相关', '的', '库'], requireRepo: ['音视频处理'] },
      { q: '嵌入式相关的开源项目', intent: 'repo', forbidRepo: ['相关', '的', '开源', '项目'], requireRepo: ['嵌入式'] },
      { q: '云原生相关的技术栈', intent: 'mixed' },
      { q: '量化交易相关的python项目', intent: 'repo', forbidRepo: ['相关', '的', '项目'], requireRepo: ['量化交易', 'python'] },
      { q: '计算机网络相关的经典书籍', intent: 'repo', forbidRepo: ['相关', '的', '经典'], requireRepo: ['计算机网络'] },
      { q: '操作系统相关的学习资料', intent: 'repo', forbidRepo: ['相关', '的'], requireRepo: ['操作系统'] },
      { q: '编译器相关的开源实现', intent: 'code', forbidRepo: ['相关', '的'], requireRepo: ['编译器'] },
      { q: '分布式系统相关的论文合集', intent: 'repo', forbidRepo: ['相关', '的', '合集'], requireRepo: ['分布式系统'] },
      { q: '网络安全相关的工具集合', intent: 'repo', forbidRepo: ['相关', '的', '工具', '集合'], requireRepo: ['网络安全'] },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidRepo, requireRepo }) => {
      it(`"${q}" → intent=${intent}, 无残留词`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidRepo && !checkQueryClean(plan, 'repo', forbidRepo, q)) ok = false
        if (requireRepo && !checkQueryContains(plan, 'repo', requireRepo, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第1轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 2 轮：中文 Issue 搜索 + 属性词
  // ============================================================
  describe('第2轮：中文 Issue 搜索 + 属性词', () => {
    const cases = [
      { q: '特别简单的issue', intent: 'issue', forbidIssue: ['简单'], requireIssue: ['good first issue'] },
      { q: '适合新手的bug', intent: 'issue', forbidIssue: ['新手', '适合'], requireIssue: ['good first issue'] },
      { q: '新手入门的issue任务', intent: 'issue', forbidIssue: ['新手', '入门', '任务'], requireIssue: ['good first issue'] },
      { q: '容易修复的bug', intent: 'issue', requireIssue: ['good first issue'] },
      { q: '轻量级的issue', intent: 'issue', forbidIssue: ['轻量', '级'], requireIssue: ['good first issue'] },
      { q: 'python报错怎么解决', intent: 'issue', forbidIssue: ['怎么解决'], requireIssue: ['python', 'error'] },
      { q: 'react组件渲染失败', intent: 'issue', requireIssue: ['react'] },
      { q: '数据库连接超时问题', intent: 'issue', requireIssue: ['数据库'] },
      { q: 'npm install权限报错', intent: 'issue', requireIssue: ['npm'] },
      { q: '内存泄漏怎么排查', intent: 'issue', forbidIssue: ['怎么排查'], requireIssue: ['内存泄漏'] },
      { q: 'docker容器启动失败', intent: 'issue', requireIssue: ['docker'] },
      { q: 'json解析异常', intent: 'issue', requireIssue: ['json'] },
      { q: 'api接口返回500错误', intent: 'issue', requireIssue: ['api'] },
      { q: 'redis缓存雪崩怎么办', intent: 'issue', forbidIssue: ['怎么办'], requireIssue: ['redis'] },
      { q: 'springboot启动报错', intent: 'issue', requireIssue: ['springboot'] },
      { q: 'vite热更新不生效', intent: 'issue', forbidIssue: ['不生效'], requireIssue: ['vite'] },
      { q: 'typescript类型不匹配', intent: 'issue', forbidIssue: ['不匹配'], requireIssue: ['typescript'] },
      { q: 'mysql死锁问题', intent: 'issue', requireIssue: ['mysql'] },
      { q: 'k8s pod一直pending', intent: 'mixed' },
      { q: '前端页面白屏怎么修复', intent: 'issue', forbidIssue: ['怎么修复'], requireIssue: ['前端'] },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidIssue, requireIssue }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidIssue && !checkQueryClean(plan, 'issue', forbidIssue, q)) ok = false
        if (requireIssue && !checkQueryContains(plan, 'issue', requireIssue, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第2轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 3 轮：中文 QA / 知识问答
  // ============================================================
  describe('第3轮：中文 QA / 知识问答', () => {
    const cases = [
      { q: 'react是什么', intent: 'qa' },
      { q: '什么是docker', intent: 'qa' },
      { q: '为什么git push失败', intent: 'qa' },
      { q: '怎么理解闭包', intent: 'qa' },
      { q: 'python和java的区别', intent: 'qa' },
      { q: 'redis原理是什么', intent: 'qa' },
      { q: '微服务和单体架构对比', intent: 'qa' },
      { q: 'http和https有什么区别', intent: 'qa' },
      { q: '什么是restful api', intent: 'qa' },
      { q: 'k8s的核心概念有哪些', intent: 'qa' },
      { q: '怎么使用git rebase', intent: 'qa' },
      { q: '函数式编程是什么意思', intent: 'qa' },
      { q: '设计模式有哪些', intent: 'qa' },
      { q: 'docker和虚拟机区别', intent: 'qa' },
      { q: '什么是ci/cd', intent: 'qa' },
      { q: 'nosql和sql的区别', intent: 'qa' },
      { q: '什么是微服务架构', intent: 'qa' },
      { q: '区块链的原理是什么', intent: 'qa' },
      { q: 'https加密原理', intent: 'qa' },
      { q: 'tcp和udp的区别', intent: 'qa' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第3轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 4 轮：中文代码搜索
  // ============================================================
  describe('第4轮：中文代码搜索', () => {
    const cases = [
      { q: 'python代码', intent: 'code' },
      { q: 'react hook实现', intent: 'code' },
      { q: '排序算法源码', intent: 'code' },
      { q: 'vue3组件代码', intent: 'code' },
      { q: 'nodejs爬虫实现', intent: 'code' },
      { q: 'websocket实现代码', intent: 'code' },
      { q: 'redis分布式锁实现', intent: 'code' },
      { q: 'jwt认证代码', intent: 'code' },
      { q: '图片压缩算法实现', intent: 'code' },
      { q: 'express中间件代码', intent: 'code' },
      { q: 'python数据分析代码', intent: 'code' },
      { q: 'react状态管理实现', intent: 'code' },
      { q: 'nginx配置代码', intent: 'code' },
      { q: 'dockerfile示例代码', intent: 'code' },
      { q: '机器学习算法实现', intent: 'code' },
      { q: 'websocket心跳实现', intent: 'code' },
      { q: '文件上传功能代码', intent: 'code' },
      { q: '权限管理实现方案', intent: 'code' },
      { q: '消息队列消费者代码', intent: 'code' },
      { q: '日志收集系统实现', intent: 'code' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第4轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 5 轮：英文仓库搜索
  // ============================================================
  describe('第5轮：英文仓库搜索', () => {
    const cases = [
      { q: 'image processing library', intent: 'mixed' },
      { q: 'popular react projects', intent: 'repo', forbidRepo: ['popular'] },
      { q: 'awesome python repos', intent: 'repo', forbidRepo: ['awesome'] },
      { q: 'best nodejs frameworks', intent: 'repo', forbidRepo: ['best'] },
      { q: 'machine learning tools', intent: 'mixed' },
      { q: 'open source games', intent: 'repo' },
      { q: 'active vue repositories', intent: 'repo', forbidRepo: ['active'] },
      { q: 'top go libraries', intent: 'repo', forbidRepo: ['top'] },
      { q: 'recommended rust projects', intent: 'repo', forbidRepo: ['recommended'] },
      { q: 'trending java frameworks', intent: 'repo', forbidRepo: ['trending'] },
      { q: 'graphql server template', intent: 'repo', forbidRepo: ['template'] },
      { q: 'react starter kit', intent: 'repo', forbidRepo: ['starter'] },
      { q: 'nextjs boilerplate', intent: 'repo', forbidRepo: ['boilerplate'] },
      { q: 'web scraping tool', intent: 'mixed' },
      { q: 'data visualization library', intent: 'mixed' },
      { q: 'api gateway framework', intent: 'mixed' },
      { q: 'cms open source project', intent: 'repo' },
      { q: 'devops automation tool', intent: 'mixed' },
      { q: 'cli tool for git', intent: 'mixed' },
      { q: 'real time chat app', intent: 'mixed' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidRepo }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidRepo && !checkQueryClean(plan, 'repo', forbidRepo, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第5轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 6 轮：英文 Issue 搜索
  // ============================================================
  describe('第6轮：英文 Issue 搜索', () => {
    const cases = [
      { q: 'good first issue react', intent: 'issue', requireIssue: ['good first issue'] },
      { q: 'help wanted python', intent: 'issue', requireIssue: ['help wanted'] },
      { q: 'beginner friendly bug', intent: 'issue', requireIssue: ['beginner'] },
      { q: 'TypeError undefined is not a function', intent: 'code' },
      { q: 'npm install failed', intent: 'issue' },
      { q: 'docker container crash', intent: 'issue' },
      { q: 'memory leak nodejs', intent: 'issue' },
      { q: 'CORS error react', intent: 'issue' },
      { q: 'connection timeout mysql', intent: 'issue' },
      { q: 'segmentation fault c++', intent: 'issue' },
      { q: 'build failed webpack', intent: 'issue' },
      { q: 'null pointer exception java', intent: 'issue' },
      { q: 'database connection refused', intent: 'issue' },
      { q: 'api returning 500 error', intent: 'issue' },
      { q: 'vite dev server not working', intent: 'issue' },
      { q: 'react hooks infinite loop bug', intent: 'issue' },
      { q: 'OOM killed kubernetes pod', intent: 'issue' },
      { q: 'redis connection timeout fix', intent: 'issue' },
      { q: 'typescript compile error', intent: 'issue' },
      { q: 'first timers only issue', intent: 'issue', requireIssue: ['first timers only'] },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, requireIssue }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (requireIssue && !checkQueryContains(plan, 'issue', requireIssue, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第6轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 7 轮：英文 QA 提问
  // ============================================================
  describe('第7轮：英文 QA 提问', () => {
    const cases = [
      { q: 'what is docker', intent: 'qa' },
      { q: 'how to use git rebase', intent: 'qa' },
      { q: 'why is my react app slow', intent: 'qa' },
      { q: 'what is the difference between sql and nosql', intent: 'qa' },
      { q: 'how does https work', intent: 'qa' },
      { q: 'explain closure in javascript', intent: 'qa' },
      { q: 'what does useMemo do', intent: 'qa' },
      { q: 'how to learn rust', intent: 'qa' },
      { q: 'which is better react or vue', intent: 'qa' },
      { q: 'react vs vue comparison', intent: 'qa' },
      { q: 'how to contribute to open source', intent: 'qa' },
      { q: 'what is kubernetes', intent: 'qa' },
      { q: 'how to fix merge conflict', intent: 'qa' },
      { q: 'what is microservices architecture', intent: 'qa' },
      { q: 'how to optimize react performance', intent: 'qa' },
      { q: 'explain event loop javascript', intent: 'qa' },
      { q: 'what is rest api', intent: 'qa' },
      { q: 'how to deploy nextjs app', intent: 'qa' },
      { q: 'difference between let and var', intent: 'qa' },
      { q: 'how to write clean code', intent: 'qa' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第7轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 8 轮：英文代码搜索
  // ============================================================
  describe('第8轮：英文代码搜索', () => {
    const cases = [
      { q: 'async function react hooks', intent: 'code' },
      { q: 'Array.map implementation', intent: 'code' },
      { q: 'Promise.all example', intent: 'code' },
      { q: 'console.log debug', intent: 'code' },
      { q: 'useState custom hook', intent: 'code' },
      { q: 'fetch api with headers', intent: 'code' },
      { q: 'class component example', intent: 'code' },
      { q: 'import export module', intent: 'code' },
      { q: 'const let var difference', intent: 'code' },
      { q: 'def python function', intent: 'code' },
      { q: 'npm install react', intent: 'code' },
      { q: 'git push origin main', intent: 'code' },
      { q: 'docker compose up', intent: 'code' },
      { q: 'redux toolkit configureStore', intent: 'code' },
      { q: 'django ORM query optimization', intent: 'code' },
      { q: 'express middleware error handling', intent: 'code' },
      { q: 'React Router setup', intent: 'code' },
      { q: 'Proxy reflect javascript', intent: 'code' },
      { q: 'setTimeout clearTimeout', intent: 'code' },
      { q: 'addEventListener click', intent: 'code' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第8轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 9 轮：中英混合查询
  // ============================================================
  describe('第9轮：中英混合查询', () => {
    const cases = [
      { q: 'react 项目推荐', intent: 'repo', forbidRepo: ['推荐', '项目'] },
      { q: 'python 报错怎么解决', intent: 'issue', forbidIssue: ['怎么解决'] },
      { q: '适合新手的 react 项目', intent: 'repo', forbidRepo: ['适合', '新手', '项目'] },
      { q: 'vue 和 react 对比', intent: 'qa' },
      { q: 'docker 是什么', intent: 'qa' },
      { q: '简单的 nodejs issue', intent: 'issue', requireIssue: ['good first issue'] },
      { q: '活跃的 go 项目', intent: 'repo' },
      { q: '优秀的 python 库', intent: 'repo', forbidRepo: ['优秀', '库'] },
      { q: 'sql 注入怎么修复', intent: 'issue', forbidIssue: ['怎么修复'] },
      { q: 'react hooks 实现代码', intent: 'code', forbidCode: ['代码'] },
      { q: 'spring boot 教程', intent: 'qa' },
      { q: 'k8s 部署失败', intent: 'issue' },
      { q: 'tailwind css 配置', intent: 'code' },
      { q: 'mongodb 连接超时', intent: 'issue' },
      { q: 'nestjs 项目模板', intent: 'repo', forbidRepo: ['项目'] },
      { q: 'graphql api 设计', intent: 'code' },
      { q: 'redis 缓存策略', intent: 'code' },
      { q: 'flutter 开源项目', intent: 'repo', forbidRepo: ['开源', '项目'] },
      { q: 'linux 常用命令', intent: 'mixed' },
      { q: 'postgresql 性能优化', intent: 'mixed' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidRepo, forbidIssue, forbidCode }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidRepo) ok = checkQueryClean(plan, 'repo', forbidRepo, q) && ok
        if (forbidIssue) ok = checkQueryClean(plan, 'issue', forbidIssue, q) && ok
        if (forbidCode) ok = checkQueryClean(plan, 'code', forbidCode, q) && ok
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第9轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 10 轮：复合词边界（容易误删的复合词）
  // ============================================================
  describe('第10轮：复合词边界测试', () => {
    const cases = [
      { q: '数据库设计项目', intent: 'repo', requireRepo: ['数据库'], forbidRepo: ['项目'] },
      { q: '图像处理算法', intent: 'repo', requireRepo: ['图像处理'] },
      { q: '机器学习框架', intent: 'repo', requireRepo: ['机器学习'], forbidRepo: ['框架'] },
      { q: '自然语言处理工具', intent: 'repo', requireRepo: ['自然语言处理'], forbidRepo: ['工具'] },
      { q: '知识图谱构建', intent: 'mixed' },
      { q: '深度强化学习', intent: 'mixed' },
      { q: '编译原理实践', intent: 'qa' },
      { q: '计算机视觉应用', intent: 'mixed' },
      { q: '分布式计算框架', intent: 'repo', requireRepo: ['分布式计算'], forbidRepo: ['框架'] },
      { q: '推荐系统引擎', intent: 'repo', requireRepo: ['引擎'] },
      { q: '中文分词工具', intent: 'repo', requireRepo: ['中文分词'], forbidRepo: ['工具'] },
      { q: '语音识别模型', intent: 'repo', requireRepo: ['语音识别'] },
      { q: '目标检测算法', intent: 'repo', requireRepo: ['目标检测'] },
      { q: '情感分析系统', intent: 'repo', requireRepo: ['情感分析'] },
      { q: '命名实体识别', intent: 'mixed' },
      { q: '图神经网络框架', intent: 'repo', requireRepo: ['图神经网络'], forbidRepo: ['框架'] },
      { q: '强化学习环境', intent: 'repo', requireRepo: ['强化学习'] },
      { q: '联邦学习平台', intent: 'repo', requireRepo: ['联邦学习'] },
      { q: '迁移学习工具', intent: 'repo', requireRepo: ['迁移学习'], forbidRepo: ['工具'] },
      { q: '生成对抗网络', intent: 'repo', requireRepo: ['生成对抗网络'] },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, requireRepo, forbidRepo }) => {
      it(`"${q}" → 保留复合词`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (requireRepo && !checkQueryContains(plan, 'repo', requireRepo, q)) ok = false
        if (forbidRepo && !checkQueryClean(plan, 'repo', forbidRepo, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第10轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 11 轮：填充词伪装成技术词（容易漏删的）
  // ============================================================
  describe('第11轮：填充词伪装测试', () => {
    const cases = [
      { q: '图像处理相关的', intent: 'mixed' },
      { q: '适合新手学习的', intent: 'mixed' },
      { q: '最近比较火的', intent: 'mixed' },
      { q: '大家都在用的', intent: 'mixed' },
      { q: '有没有好用的', intent: 'qa' },
      { q: '帮我推荐一个', intent: 'mixed' },
      { q: '求大佬推荐', intent: 'qa' },
      { q: '请问有哪些', intent: 'qa' },
      { q: '想找一些', intent: 'mixed' },
      { q: '看看有什么', intent: 'mixed' },
      { q: '跪求好的', intent: 'qa' },
      { q: '麻烦推荐几个', intent: 'mixed' },
      { q: '我想要一个', intent: 'mixed' },
      { q: '找点好玩的', intent: 'mixed' },
      { q: '大佬们都在用啥', intent: 'mixed' },
      { q: '这个方向有啥', intent: 'mixed' },
      { q: '那种比较好的', intent: 'mixed' },
      { q: '类似的项目', intent: 'repo' },
      { q: '同类型的工具', intent: 'repo' },
      { q: '相关的资料', intent: 'mixed' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → 系统不崩溃且返回有效计划`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第11轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 12 轮：短查询边界
  // ============================================================
  describe('第12轮：短查询边界', () => {
    const cases = [
      { q: 'react', intent: 'mixed' },
      { q: 'python', intent: 'mixed' },
      { q: 'vue', intent: 'mixed' },
      { q: 'docker', intent: 'mixed' },
      { q: 'k8s', intent: 'mixed' },
      { q: 'go', intent: 'mixed' },
      { q: 'rust', intent: 'mixed' },
      { q: 'sql', intent: 'mixed' },
      { q: 'api', intent: 'mixed' },
      { q: 'cli', intent: 'mixed' },
      { q: '前端', intent: 'mixed' },
      { q: '后端', intent: 'mixed' },
      { q: '数据库', intent: 'mixed' },
      { q: '算法', intent: 'repo' },
      { q: '架构', intent: 'repo' },
      { q: '安全', intent: 'mixed' },
      { q: '性能', intent: 'mixed' },
      { q: '测试', intent: 'mixed' },
      { q: '部署', intent: 'mixed' },
      { q: '监控', intent: 'mixed' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → ${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q) && (intent === 'mixed' ? plan.sources.length >= 4 : true)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第12轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 13 轮：属性词在不同位置
  // ============================================================
  describe('第13轮：属性词位置测试', () => {
    const cases = [
      { q: '简单的python项目', intent: 'repo', expectFilters: true },
      { q: 'python简单项目', intent: 'repo', expectFilters: true },
      { q: '简单的python', intent: 'mixed' },
      { q: 'python简单', intent: 'mixed' },
      { q: '新手适合的项目', intent: 'repo', expectFilters: true },
      { q: '项目新手入门', intent: 'repo', expectFilters: true },
      { q: '活跃的go仓库', intent: 'repo', expectFilters: true },
      { q: 'go活跃项目', intent: 'repo', expectFilters: true },
      { q: '高质量java项目', intent: 'repo', expectFilters: true },
      { q: 'java高质量', intent: 'mixed' },
      { q: '轻量级node框架', intent: 'repo', expectFilters: true },
      { q: 'node轻量框架', intent: 'repo', expectFilters: true },
      { q: '优秀的rust项目', intent: 'repo', expectFilters: true },
      { q: 'rust优秀项目', intent: 'repo', expectFilters: true },
      { q: '复杂的c++项目', intent: 'repo', expectFilters: true },
      { q: 'c++复杂项目', intent: 'repo', expectFilters: true },
      { q: '新手友好的issue', intent: 'issue', requireIssue: ['good first issue'] },
      { q: 'issue新手入门', intent: 'issue', requireIssue: ['good first issue'] },
      { q: '简单的bug修复', intent: 'issue', requireIssue: ['good first issue'] },
      { q: 'bug简单修复', intent: 'issue', forbidIssue: ['简单'] },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, expectFilters, requireIssue, forbidIssue }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (expectFilters !== undefined) {
          const hasFilters = Object.keys(plan.filters || {}).length > 0
          if (hasFilters !== expectFilters) {
            console.warn(`  [过滤错误] "${q}" → filters=${JSON.stringify(plan.filters)}, 期望有过滤=${expectFilters}`)
            ok = false
          }
        }
        if (requireIssue && !checkQueryContains(plan, 'issue', requireIssue, q)) ok = false
        if (forbidIssue && !checkQueryClean(plan, 'issue', forbidIssue, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第13轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 14 轮：Bang 前缀
  // ============================================================
  describe('第14轮：Bang 前缀测试', () => {
    const cases = [
      { q: '!repo python', intent: 'repo' },
      { q: '!仓库 python', intent: 'repo' },
      { q: '!项目 python', intent: 'repo' },
      { q: '!issue react', intent: 'issue' },
      { q: '!问题 react', intent: 'issue' },
      { q: '!code python', intent: 'code' },
      { q: '!代码 python', intent: 'code' },
      { q: '!qa docker', intent: 'qa' },
      { q: '!问 docker', intent: 'qa' },
      { q: '!repo 图像处理', intent: 'repo', requireRepo: ['图像处理'] },
      { q: '!issue 数据库连接失败', intent: 'issue' },
      { q: '!code 排序算法', intent: 'code' },
      { q: '!qa 什么是闭包', intent: 'qa' },
      { q: '!repo machine learning', intent: 'repo' },
      { q: '!issue react hooks bug', intent: 'issue' },
      { q: '!code async function', intent: 'code' },
      { q: '!qa what is docker', intent: 'qa' },
      { q: '!repo 自然语言处理', intent: 'repo', requireRepo: ['自然语言处理'] },
      { q: '!仓库 图像处理相关的', intent: 'repo', requireRepo: ['图像处理'] },
      { q: '!项目 深度学习框架', intent: 'repo', requireRepo: ['深度学习'] },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, requireRepo, forbidRepo }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (requireRepo && !checkQueryContains(plan, 'repo', requireRepo, q)) ok = false
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第14轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 15 轮：问题词组合（之前出过 bug 的）
  // ============================================================
  describe('第15轮：已知问题回归', () => {
    const cases = [
      { q: '特别简单的issue', intent: 'issue', requireIssue: ['good first issue'], forbidIssue: ['特别'] },
      { q: '特别简单的python项目', intent: 'repo', forbidRepo: ['特别', '简单', '项目'] },
      { q: '图像处理相关的仓库', intent: 'repo', forbidRepo: ['相关', '的', '仓库'], requireRepo: ['图像处理'] },
      { q: 'python报错怎么解决', intent: 'issue', forbidIssue: ['怎么解决'] },
      { q: 'react教程', intent: 'qa' },
      { q: '适合新手的react项目', intent: 'repo', forbidRepo: ['适合', '新手', '的', '项目'] },
      { q: '数据库设计', intent: 'mixed' },
      { q: '机器学习入门', intent: 'mixed' },
      { q: '自然语言处理工具', intent: 'repo', requireRepo: ['自然语言处理'], forbidRepo: ['工具'] },
      { q: '知识图谱构建', intent: 'mixed' },
      { q: '活跃的go项目', intent: 'repo', forbidRepo: ['活跃', '的', '项目'] },
      { q: '高质量的python库', intent: 'repo', forbidRepo: ['的'] },
      { q: '最近更新的react框架', intent: 'repo', forbidRepo: ['最近', '更新', '的', '框架'] },
      { q: '好用的vscode插件', intent: 'code' },
      { q: '流行的前端工具', intent: 'repo', forbidRepo: ['流行', '的', '工具'] },
      { q: '经典的算法书籍', intent: 'repo', forbidRepo: ['经典', '的'] },
      { q: '轻量级的http库', intent: 'repo', forbidRepo: ['轻量', '级', '的'] },
      { q: '简单的nodejs issue', intent: 'issue', requireIssue: ['good first issue'] },
      { q: '新手bug修复', intent: 'issue', forbidIssue: ['新手', '修复'] },
      { q: '简单的入门教程', intent: 'qa' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidRepo, requireRepo, forbidIssue, requireIssue }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidRepo) ok = checkQueryClean(plan, 'repo', forbidRepo, q) && ok
        if (requireRepo) ok = checkQueryContains(plan, 'repo', requireRepo, q) && ok
        if (forbidIssue) ok = checkQueryClean(plan, 'issue', forbidIssue, q) && ok
        if (requireIssue) ok = checkQueryContains(plan, 'issue', requireIssue, q) && ok
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第15轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 16 轮：真实多词技术术语
  // ============================================================
  describe('第16轮：多词技术术语', () => {
    const cases = [
      { q: 'react server components', intent: 'mixed' },
      { q: 'graphql subscription implementation', intent: 'code' },
      { q: 'kubernetes operator pattern', intent: 'mixed' },
      { q: 'event sourcing cqrs', intent: 'mixed' },
      { q: 'domain driven design', intent: 'mixed' },
      { q: 'clean architecture example', intent: 'mixed' },
      { q: 'micro frontend framework', intent: 'mixed' },
      { q: 'service mesh comparison', intent: 'mixed' },
      { q: 'api gateway pattern', intent: 'mixed' },
      { q: 'circuit breaker implementation', intent: 'code' },
      { q: 'saga pattern microservices', intent: 'mixed' },
      { q: 'event driven architecture', intent: 'mixed' },
      { q: 'hexagonal architecture example', intent: 'mixed' },
      { q: 'cqrs event sourcing', intent: 'mixed' },
      { q: 'strangler fig pattern', intent: 'mixed' },
      { q: 'sidecar pattern kubernetes', intent: 'mixed' },
      { q: 'ambassador pattern', intent: 'mixed' },
      { q: 'bulkhead pattern', intent: 'mixed' },
      { q: 'retry pattern implementation', intent: 'code' },
      { q: 'backpressure handling', intent: 'mixed' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第16轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 17 轮：教程/学习型查询
  // ============================================================
  describe('第17轮：教程/学习型查询', () => {
    const cases = [
      { q: 'react基础教程', intent: 'qa' },
      { q: 'python入门教程', intent: 'qa' },
      { q: 'docker使用教程', intent: 'qa' },
      { q: 'git新手教程', intent: 'qa' },
      { q: 'typescript学习教程', intent: 'qa' },
      { q: 'vue3快速教程', intent: 'qa' },
      { q: 'nodejs完整教程', intent: 'qa' },
      { q: 'springboot实战教程', intent: 'qa' },
      { q: '微信小程序开发教程', intent: 'qa' },
      { q: 'flutter视频教程', intent: 'qa' },
      { q: '怎么使用docker', intent: 'qa' },
      { q: '如何使用webpack', intent: 'qa' },
      { q: 'k8s怎么用', intent: 'qa' },
      { q: 'mongodb用法', intent: 'qa' },
      { q: 'redis使用教程', intent: 'qa' },
      { q: 'react hooks怎么用', intent: 'qa' },
      { q: 'tailwindcss使用方法', intent: 'qa' },
      { q: 'graphql教程', intent: 'qa' },
      { q: 'rust入门教程', intent: 'qa' },
      { q: 'nextjs教程', intent: 'qa' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        const ok = checkIntent(plan, intent, q)
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第17轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 18 轮：新手友好型查询
  // ============================================================
  describe('第18轮：新手友好型查询', () => {
    const cases = [
      { q: '适合新手的项目', intent: 'repo', forbidRepo: ['适合', '新手', '的', '项目'] },
      { q: '新手友好的仓库', intent: 'repo', forbidRepo: ['新手', '友好', '的', '仓库'] },
      { q: '零基础入门项目', intent: 'repo', forbidRepo: ['零基础', '入门', '项目'] },
      { q: '小白也能用的工具', intent: 'repo', forbidRepo: ['小白', '的', '工具'] },
      { q: '适合初学者的框架', intent: 'repo', forbidRepo: ['适合', '初学者', '的', '框架'] },
      { q: '菜鸟也能看懂的项目', intent: 'repo', forbidRepo: ['菜鸟', '的', '项目'] },
      { q: '新手入门的issue', intent: 'issue', requireIssue: ['good first issue'] },
      { q: '适合新人的bug', intent: 'issue', requireIssue: ['good first issue'] },
      { q: 'beginner friendly projects', intent: 'repo', forbidRepo: ['beginner', 'friendly', 'projects'] },
      { q: 'good first issue react', intent: 'issue', requireIssue: ['good first issue'] },
      { q: 'starter projects for beginners', intent: 'repo', forbidRepo: ['starter'] },
      { q: 'easy python projects', intent: 'repo', forbidRepo: ['easy', 'projects'] },
      { q: 'simple nodejs repos', intent: 'repo', forbidRepo: ['simple'] },
      { q: 'newcomer friendly codebase', intent: 'code' },
      { q: 'first contribution projects', intent: 'repo', forbidRepo: ['first', 'contribution', 'projects'] },
      { q: 'help wanted issues python', intent: 'issue', requireIssue: ['help wanted'] },
      { q: 'up for grabs typescript', intent: 'issue', requireIssue: ['up for grabs'] },
      { q: 'first timers only javascript', intent: 'issue', requireIssue: ['first timers only'] },
      { q: '适合学习的开源项目', intent: 'repo', forbidRepo: ['适合', '学习', '的', '开源', '项目'] },
      { q: '初学者友好的代码库', intent: 'code' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidRepo, requireIssue }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidRepo) ok = checkQueryClean(plan, 'repo', forbidRepo, q) && ok
        if (requireIssue) ok = checkQueryContains(plan, 'issue', requireIssue, q) && ok
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第18轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 19 轮：自然语言中嵌入过滤条件
  // ============================================================
  describe('第19轮：自然语言嵌入过滤条件', () => {
    const cases = [
      { q: '小型python项目', intent: 'repo', expectMaxStars: 1000 },
      { q: '大型java项目', intent: 'repo', expectMinStars: 5000 },
      { q: '中型前端框架', intent: 'repo', expectMinStars: 1000, expectMaxStars: 5000 },
      { q: '微型的go工具', intent: 'repo', expectMaxStars: 1000 },
      { q: '轻量级的http库', intent: 'repo', expectMaxStars: 1000 },
      { q: 'star一千以上的python项目', intent: 'repo', expectMinStars: 1000 },
      { q: '最近一年更新的项目', intent: 'repo', expectCreatedAfter: true },
      { q: '最近半年的新项目', intent: 'repo', expectCreatedAfter: true },
      { q: '最近三个月内的仓库', intent: 'repo', expectCreatedAfter: true },
      { q: '活跃的react项目', intent: 'repo', expectUpdatedAfter: true, expectMinStars: 100 },
      { q: '最新的vue项目', intent: 'repo', expectSort: 'updated' },
      { q: '最热的python项目', intent: 'repo', expectSort: 'stars' },
      { q: '热门的go框架', intent: 'repo', expectSort: 'stars' },
      { q: 'star最多项目', intent: 'repo', expectSort: 'stars' },
      { q: '一万star以上项目', intent: 'repo', expectMinStars: 10000 },
      { q: '5k以上的python库', intent: 'repo', expectMinStars: 5000 },
      { q: '今年新出的框架', intent: 'repo', expectCreatedAfter: true },
      { q: '最近更新的工具', intent: 'repo', expectUpdatedAfter: true },
      { q: '活跃维护中的项目', intent: 'repo', expectUpdatedAfter: true, expectMinStars: 100 },
      { q: '企业级大型项目', intent: 'repo', expectMinStars: 5000 },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, expectMinStars, expectMaxStars, expectCreatedAfter, expectUpdatedAfter, expectSort }) => {
      it(`"${q}" → 正确提取过滤条件`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false

        const f = plan.filters || {}
        if (expectMinStars !== undefined && f.minStars !== expectMinStars) {
          console.warn(`  [星数错误] "${q}" → minStars=${f.minStars}, 期望=${expectMinStars}`)
          ok = false
        }
        if (expectMaxStars !== undefined && f.maxStars !== expectMaxStars) {
          console.warn(`  [星数错误] "${q}" → maxStars=${f.maxStars}, 期望=${expectMaxStars}`)
          ok = false
        }
        if (expectCreatedAfter === true && !f.createdAfter) {
          console.warn(`  [时间错误] "${q}" → 缺少createdAfter`)
          ok = false
        }
        if (expectUpdatedAfter === true && !f.updatedAfter) {
          console.warn(`  [时间错误] "${q}" → 缺少updatedAfter`)
          ok = false
        }
        if (expectSort !== undefined && f.sort !== expectSort) {
          console.warn(`  [排序错误] "${q}" → sort=${f.sort}, 期望=${expectSort}`)
          ok = false
        }
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第19轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 第 20 轮：复杂混合查询（真实用户场景）
  // ============================================================
  describe('第20轮：真实用户场景', () => {
    const cases = [
      { q: '帮我找一个适合新手的python开源项目', intent: 'repo', forbidRepo: ['帮我', '找', '一个', '适合', '新手', '的', '开源', '项目'] },
      { q: '有没有好用的react组件库推荐', intent: 'repo', forbidRepo: ['有没有', '好用', '的', '推荐'] },
      { q: '最近比较火的ai项目有哪些', intent: 'repo', forbidRepo: ['最近', '比较', '火', '的', '有哪些', '项目'] },
      { q: '求大佬推荐几个高质量的go框架', intent: 'repo', forbidRepo: ['求', '大佬', '推荐', '几个', '的', '框架'] },
      { q: '想找一个轻量级的nodejs后端框架', intent: 'repo', forbidRepo: ['想找', '一个', '轻量', '级', '的', '框架'] },
      { q: '请问docker怎么部署nextjs项目', intent: 'qa' },
      { q: 'python数据分析相关的库有哪些', intent: 'qa' },
      { q: '前端性能优化有没有好的工具推荐', intent: 'qa' },
      { q: '适合新手的简单issue有哪些', intent: 'issue', requireIssue: ['good first issue'] },
      { q: '怎么解决react useEffect无限循环的问题', intent: 'issue', forbidIssue: ['怎么解决', '的'] },
      { q: 'k8s部署springboot应用报错怎么处理', intent: 'issue', forbidIssue: ['怎么处理'] },
      { q: '想学习rust有没有推荐的入门项目', intent: 'repo', forbidRepo: ['有没有', '推荐', '的', '入门', '项目'] },
      { q: '大家推荐一下好用的vscode插件', intent: 'code' },
      { q: '找一个活跃的python机器学习项目', intent: 'repo', forbidRepo: ['找', '一个', '活跃', '的', '项目'] },
      { q: '最近比较流行的前端框架对比', intent: 'qa' },
      { q: '有没有适合零基础学习的python教程', intent: 'qa' },
      { q: '请问java和kotlin在安卓开发上有什么区别', intent: 'qa' },
      { q: '帮我推荐一个简单的适合新手的issue', intent: 'issue', requireIssue: ['good first issue'], forbidIssue: ['简单', '适合', '新手'] },
      { q: '想找一个数据可视化相关的开源javascript库', intent: 'repo', forbidRepo: ['想找', '一个', '相关', '的', '开源'] },
      { q: '微服务架构中服务间通信的最佳实践', intent: 'qa' },
    ]

    let pass = 0, fail = 0
    cases.forEach(({ q, intent, forbidRepo, forbidIssue, requireIssue }) => {
      it(`"${q}" → intent=${intent}`, () => {
        const plan = routeQuery(q)
        let ok = true
        if (!checkIntent(plan, intent, q)) ok = false
        if (forbidRepo) ok = checkQueryClean(plan, 'repo', forbidRepo, q) && ok
        if (forbidIssue) ok = checkQueryClean(plan, 'issue', forbidIssue, q) && ok
        if (requireIssue) ok = checkQueryContains(plan, 'issue', requireIssue, q) && ok
        if (ok) pass++; else fail++
        expect(ok).toBe(true)
      })
    })

    afterAll(() => {
      console.log(`\n  第20轮结果: ${pass}/${cases.length} 通过, ${fail} 失败`)
    })
  })

  // ============================================================
  // 性能基准
  // ============================================================
  describe('性能基准', () => {
    it('所有20轮测试用例单次调用平均 < 5ms', () => {
      const allQueries = [
        '图像处理相关的仓库', '特别简单的issue', 'python报错怎么解决',
        'react是什么', 'python代码', 'image processing library',
        'good first issue react', 'what is docker', 'async function react hooks',
        'react 项目推荐', '数据库设计项目', '适合新手学习的',
        'react', '简单的python项目', '!repo python',
        'react server components', 'react基础教程', '适合新手的项目',
        '小型python项目', '帮我找一个适合新手的python开源项目',
      ]
      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        for (const q of allQueries) {
          routeQuery(q)
        }
      }
      const elapsed = performance.now() - start
      const avgMs = elapsed / (100 * allQueries.length)
      console.log(`\n  平均每次调用: ${avgMs.toFixed(3)}ms`)
      expect(avgMs).toBeLessThan(5)
    })
  })
})