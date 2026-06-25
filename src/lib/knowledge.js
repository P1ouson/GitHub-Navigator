/**
 * RAG 知识库 — GitHub 使用 FAQ
 *
 * 存储开源参与相关的常见问题与答案。
 * 关键词匹配 → 按相关性排序返回 Top-N 结果。
 * 后续可升级为向量嵌入检索（Transformers.js / LLM）。
 */

const KB = [
  // ===== Git 基础 =====
  {
    id: 'git-fork',
    keywords: ['fork', '复刻', '复制仓库', 'copy repo'],
    category: 'git',
    title: '什么是 Fork？',
    body: `Fork 是将别人的 GitHub 仓库复制一份到你的 GitHub 账号下。

操作方式：
1. 进入目标仓库页面，点击右上角 "Fork" 按钮
2. 选择目标账号（你自己），点击 Create Fork

Fork 后你会得到一份完全独立的副本：
• 可以自由修改、提交，不影响原仓库
• 可以通过 Pull Request 将修改贡献回原仓库
• 原仓库更新后可以同步到你的 Fork

Fork vs Clone：
• Fork = 在 GitHub 服务器上复制（远程到远程）
• Clone = 从 GitHub 下载到本地电脑（远程到本地）
• 通常流程：先 Fork，再 Clone 到本地`,
  },
  {
    id: 'git-clone',
    keywords: ['clone', '克隆', '下载仓库', 'git clone', '本地'],
    category: 'git',
    title: '什么是 Clone？',
    body: `Clone 是将 GitHub 上的仓库完整下载到你的本地电脑。

命令：git clone <仓库地址>

Clone 会下载：
• 所有代码文件
• 完整的提交历史
• 所有分支

常见用法：
1. git clone https://github.com/owner/repo.git  （HTTPS）
2. git clone git@github.com:owner/repo.git      （SSH，需配置密钥）

提示：如果你要先 Fork 再 Clone，记得 Clone 你自己的 Fork 地址，而不是原仓库。`,
  },
  {
    id: 'git-commit',
    keywords: ['commit', '提交', 'git commit', '提交记录'],
    category: 'git',
    title: '什么是 Commit（提交）？',
    body: `Commit 是 Git 的基本操作，把本地的修改保存为一个版本记录。

每个 Commit 包含：
• 修改的文件内容
• 提交信息（commit message，描述这次改了什么）
• 时间戳和作者信息

最佳实践：
• Commit message 要简洁明了，如 "fix: 修复登录页面报错"
• 每个 Commit 只做一件事，便于回溯
• 频繁 Commit，不要攒大量修改一次性提交

常用命令：
• git add <文件>  →  暂存修改
• git commit -m "描述信息"  →  提交暂存的修改
• git log  →  查看提交历史`,
  },
  {
    id: 'git-push',
    keywords: ['push', '推送', 'git push', '上传', '提交到远程'],
    category: 'git',
    title: '什么是 Push（推送）？',
    body: `Push 是将本地的 Commit 上传到远程仓库（如 GitHub）。

命令：git push origin <分支名>

流程：
1. 本地完成 Commit
2. git push 将 Commit 上传到 GitHub
3. 其他人就能看到你的修改

第一次推送新分支：
git push -u origin <分支名>
（-u 建立本地分支与远程分支的关联，后续只需 git push）`,
  },
  {
    id: 'git-pull',
    keywords: ['pull', '拉取', 'git pull', '同步', '更新本地'],
    category: 'git',
    title: '什么是 Pull（拉取）？',
    body: `Pull 是从远程仓库获取最新的修改并合并到本地。

命令：git pull origin <分支名>

实际执行了两个操作：
1. git fetch  →  下载远程的最新数据
2. git merge  →  合并到本地分支

经常 Pull 保持本地代码最新，减少冲突。`,
  },
  {
    id: 'git-branch',
    keywords: ['branch', '分支', 'git branch', '创建分支', '切换分支'],
    category: 'git',
    title: '什么是分支（Branch）？',
    body: `分支是 Git 的核心概念，让你在独立的时间线上开发，不影响主分支。

常用命令：
• git branch          →  查看本地分支列表
• git branch <名字>    →  创建新分支
• git checkout <名字>  →  切换分支
• git checkout -b <名字>  →  创建并切换

命名规范：
• main / master  →  主分支（稳定版本）
• feature/xxx    →  新功能分支
• fix/xxx        →  修复分支
• docs/xxx       →  文档更新分支

开源贡献中：永远不要在 main 分支上直接修改，新建一个分支再提交 PR。`,
  },
  {
    id: 'git-merge',
    keywords: ['merge', '合并', 'git merge', '合并分支', '解决冲突'],
    category: 'git',
    title: '什么是 Merge（合并）？',
    body: `Merge 是将两个分支的修改合并到一起。

命令：git merge <要合并的分支>

场景：你在 feature/login 分支开发完登录功能后，把它合并回 main。
流程：
1. git checkout main     →  切换到目标分支
2. git merge feature/login  →  合并功能分支

Merge 会自动创建一个"合并提交"（merge commit），保留两个分支的历史。

Rebase 是另一种合并方式，历史更线性，但操作更复杂。新手建议用 Merge。`,
  },
  {
    id: 'git-conflict',
    keywords: ['conflict', '冲突', '解决冲突', 'merge conflict', '冲突解决'],
    category: 'git',
    title: '什么是冲突（Conflict）？',
    body: `冲突是指两个人修改了同一文件的同一行代码，Git 无法自动决定保留哪个版本。

冲突标记示例：
<<<<<<< HEAD
  你的修改
=======
  别人的修改
>>>>>>> feature/xxx

解决步骤：
1. 打开冲突文件，手动选择保留哪个版本
2. 删除 <<<<<<<、=======、>>>>>>> 标记
3. git add <文件>  →  标记为已解决
4. git commit      →  完成合并

预防冲突：
• 经常 Pull 保持代码最新
• 同一文件先沟通再修改
• 小步提交，频繁合并`,
  },
  {
    id: 'git-rebase',
    keywords: ['rebase', '变基', 'git rebase', '合并历史'],
    category: 'git',
    title: '什么是 Rebase（变基）？',
    body: `Rebase 是将你的提交"嫁接"到目标分支的最新位置，历史更线性整洁。

命令：git rebase main

与 Merge 的区别：
• Merge：保留完整分支历史，有 merge commit
• Rebase：历史变成一条直线，没有 merge commit

注意：
• 已经 Push 到远程的 Commit 不要 Rebase（会改写历史）
• Rebase 后需要 git push --force-with-lease（谨慎使用）
• 新手建议先用 Merge，熟悉后再用 Rebase`,
  },

  // ===== GitHub 功能 =====
  {
    id: 'github-pr',
    keywords: ['pr', 'pull request', '拉取请求', 'pr提交', '合并请求'],
    category: 'github',
    title: '什么是 Pull Request（PR）？',
    body: `Pull Request（简称 PR）是通知原仓库作者"我修改了一些代码，请合并"。

PR 流程：
1. Fork 目标仓库
2. Clone 到本地，创建新分支
3. 修改代码、Commit、Push
4. 在 GitHub 上发起 PR（从你的分支 → 原仓库的主分支）
5. 等待审核（Code Review）
6. 审核通过后合并

PR 内容建议：
• 清晰的标题（如 "fix: 修复登录页 401 错误"）
• 描述改了什么、为什么改、怎么测试
• 关联相关 Issue（如 "Closes #42"）

PR 是开源贡献的核心协作方式，也是你参与开源的第一步。`,
  },
  {
    id: 'github-issue',
    keywords: ['issue', '问题', '报告问题', 'bug报告', '功能请求', '提issue'],
    category: 'github',
    title: '什么是 Issue？',
    body: `Issue 是 GitHub 上的任务/问题跟踪系统，用来：
• 报告 Bug
• 提出新功能
• 讨论改进方案

提 Issue 的最佳实践：
1. 先搜索是否已有类似 Issue
2. 标题简洁明了
3. 内容包含：
   - 环境信息（OS、版本等）
   - 复现步骤
   - 期望行为和实际行为
   - 截图/日志（如有）

新手可以从 good first issue 标签的 Issue 开始参与。`,
  },
  {
    id: 'github-actions',
    keywords: ['actions', 'action', '自动化', 'ci', 'cd', '工作流', 'github actions'],
    category: 'github',
    title: '什么是 GitHub Actions？',
    body: `GitHub Actions 是 GitHub 自带的 CI/CD（持续集成/持续部署）工具。

它可以自动执行：
• 代码推送到仓库时自动运行测试
• PR 提交时自动检查代码质量
• 发布新版本时自动部署
• 定时任务（如每周更新依赖）

配置文件放在 .github/workflows/ 目录下，使用 YAML 格式。

对新手来说，你不需要自己配置 Actions，但需要理解 PR 被自动检查时那些绿色（通过）和红色（失败）的标记是什么意思。`,
  },
  {
    id: 'github-pages',
    keywords: ['pages', 'github pages', '静态网站', '部署网站', '个人主页'],
    category: 'github',
    title: '什么是 GitHub Pages？',
    body: `GitHub Pages 是一个免费的静态网站托管服务。

可以用来：
• 个人/项目主页
• 项目文档站点
• 博客

使用方式：
1. 创建一个仓库叫 <你的用户名>.github.io
2. 把 HTML/CSS/JS 文件 Push 到 main 分支
3. 访问 https://<你的用户名>.github.io

GitHub Pages 自动绑定，不需要任何服务器配置。`,
  },
  {
    id: 'github-star',
    keywords: ['star', '收藏', '点赞仓库', '加星', 'stars'],
    category: 'github',
    title: '什么是 Star（收藏）？',
    body: `Star 是 GitHub 上的"收藏"功能，相当于给仓库点赞。

作用：
• 收藏你感兴趣的项目
• 表示对项目的认可
• 帮助项目获得更多曝光

Star 不等于 Fork：
• Star 只是收藏，不会复制仓库
• 你可以随时在 GitHub 头像 → Your stars 里找到所有收藏的仓库

开源项目的 Star 数反映其受欢迎程度，但不代表代码质量。`,
  },
  {
    id: 'github-watch',
    keywords: ['watch', '关注', '订阅通知', 'watching'],
    category: 'github',
    title: '什么是 Watch（关注）？',
    body: `Watch 是关注仓库的动态，有更新时接收通知。

三种模式：
1. 不关注（默认）— 只接收 @提及你的通知
2. 关注 — 接收所有讨论和 PR 的通知
3. 忽略 — 不接收任何通知

适合场景：
• 你正在积极参与的项目 → 关注
• 只是偶尔看看的项目 → 不关注
• 噪音太多的项目 → 忽略`,
  },

  // ===== 开源参与 =====
  {
    id: 'oss-contribute',
    keywords: ['贡献', '参与开源', 'contribute', '贡献代码', '第一次贡献'],
    category: 'oss',
    title: '如何参与开源项目？',
    body: `参与开源并不难，按以下步骤开始：

第一步：找到合适的项目
• 搜索 good first issue 标签的 Issue
• 选择你熟悉技术栈的项目
• 从文档/教程项目开始（门槛较低）

第二步：理解项目
• 阅读 README.md 和 CONTRIBUTING.md
• 了解项目的贡献指南
• 在 Issue 下留言表明你想参与

第三步：贡献
• Fork → Clone → 创建分支 → 修改 → Push → PR

不一定要写代码！
• 修文档（typo、翻译）
• 回复 Issue 问题
• 测试新功能并反馈
• 分享项目

关键是从小处开始，第一次 PR 哪怕是修正一个标点符号也是好的开始。`,
  },
  {
    id: 'oss-good-first-issue',
    keywords: ['good first issue', '新手任务', '入门问题', '新手友好', 'gfi', '适合新手'],
    category: 'oss',
    title: '什么是 Good First Issue？',
    body: `Good First Issue 是项目维护者标记的"适合新手"的任务。

特点：
• 任务范围明确，通常改动不大
• 会提供足够的上下文和指引
• 维护者会更耐心地 Review

在哪里找：
1. 在 GitHub 搜索标签：label:"good first issue"
2. 本项目的搜索功能可以直接搜
3. 专门的网站：goodfirstissue.dev

你还可以关注 help wanted 标签，表示项目正在寻求帮助。`,
  },
  {
    id: 'oss-code-review',
    keywords: ['code review', '代码审查', 'review', '审核', 'cr'],
    category: 'oss',
    title: '什么是 Code Review？',
    body: `Code Review（代码审查）是其他人检查你的代码修改，给出反馈建议。

Review 会关注：
• 代码逻辑是否正确
• 是否有更好的实现方式
• 是否遵循项目编码规范
• 是否有测试覆盖

作为提交者：
• 认真对待每一条 Review 意见
• 有不同意见可以讨论
• 修改后及时回复

作为审查者：
• 友善 constructive 地提建议
• 解释"为什么"，不是只说"改一下"
• 关注重要问题，不拘泥于代码风格

Code Review 是开源协作中最重要的环节之一。`,
  },
  {
    id: 'oss-license',
    keywords: ['license', '许可证', '开源协议', '授权', '开源许可'],
    category: 'oss',
    title: '什么是开源许可证？',
    body: `开源许可证规定了别人可以怎么使用你的代码。

常见许可证：
• MIT — 最宽松，几乎可以做任何事
• Apache 2.0 — 类似 MIT，包含专利条款
• GPL — 传染性，衍生项目也必须开源
• BSD — 类似 MIT，强调保留版权声明
• MPL — 介于 MIT 和 GPL 之间

作为使用者：
• 必须遵守项目的许可证
• 商业项目避免使用 GPL 代码

作为发布者：
• 如果不知道选什么，MIT 是最安全的选择
• 在仓库根目录放一个 LICENSE 文件`,
  },
  {
    id: 'oss-contributing-md',
    keywords: ['contributing', '贡献指南', 'contributing.md', '如何参与'],
    category: 'oss',
    title: '什么是 CONTRIBUTING.md？',
    body: `CONTRIBUTING.md 是项目的贡献指南文件，通常在仓库根目录。

内容包括：
• 如何报告 Bug
• 如何提交新功能
• 编码规范和风格
• PR 提交流程
• 本地开发环境搭建

在 Contribution 之前一定要先看这个文件！
它告诉你项目维护者的期望，避免白费功夫。`,
  },
  {
    id: 'oss-community',
    keywords: ['社区', '维护者', 'committer', 'collaborator', '组织', 'organization'],
    category: 'oss',
    title: '开源项目有哪些角色？',
    body: `一个典型的开源项目有这些角色：

• 作者（Author）— 项目发起人
• 维护者（Maintainer）— 负责管理项目、审核 PR
• Committer — 有直接提交代码权限的人
• Contributor — 贡献过代码/文档/Issue 的人
• 用户（User）— 使用项目的人

从用户到维护者的路径：
User → Contributor → Committer → Maintainer

大部分贡献者停留在 Contributor 阶段就已经很棒了！
不需要成为 Maintainer 也能产生巨大影响。`,
  },
  {
    id: 'oss-github-flow',
    keywords: ['github flow', '工作流', 'git工作流', '协作流程', '开发流程'],
    category: 'oss',
    title: 'GitHub Flow 是什么？',
    body: `GitHub Flow 是 GitHub 推荐的轻量级协作工作流：

1. main 分支始终保持可部署状态
2. 新功能从 main 创建新分支
3. 在分支上开发，经常 Commit
4. 提交 PR 请求合并
5. 通过 Code Review 后合并到 main
6. 合并后自动部署

核心原则：
• 不要在 main 上直接修改
• 频繁提交小 PR（而非一个大 PR）
• PR 通过 Review 后再合并

这是目前最流行的开源协作模式，简单高效。`,
  },

  // ===== 实用技巧 =====
  {
    id: 'tip-gitignore',
    keywords: ['gitignore', '忽略文件', '不追踪', '.gitignore'],
    category: 'tips',
    title: '什么是 .gitignore？',
    body: `.gitignore 文件告诉 Git 哪些文件不要追踪。

常见需要忽略的文件：
• node_modules/ — npm 依赖包
• .env — 环境变量（含密钥）
• dist/ — 编译产物
• *.log — 日志文件
• .DS_Store — macOS 系统文件

每个项目都应该有 .gitignore，避免不小心提交敏感信息。`,
  },
  {
    id: 'tip-readme',
    keywords: ['readme', 'readme.md', '项目说明', '项目文档'],
    category: 'tips',
    title: '好的 README 应该包含什么？',
    body: `README.md 是项目的门面，好的 README 应该包含：

1. 项目名称 + 一句话简介
2. 项目截图或 Demo（可选）
3. 快速开始（安装和运行）
4. 使用说明
5. API 文档（如果是库）
6. 如何贡献
7. 许可证

对于新手：先看 README 的"快速开始"部分就能跑起来，
"如何贡献"部分告诉你如何参与。`,
  },

  // ===== Git 进阶操作 =====
  {
    id: 'git-stash',
    keywords: ['stash', '暂存', 'git stash', '保存修改', '切换分支暂存', 'stash pop'],
    category: 'git',
    title: '什么是 git stash（暂存）？',
    body: `git stash 把当前未提交的修改临时保存起来，让工作区变干净，方便切换分支。

常用命令：
• git stash                →  暂存当前修改
• git stash list           →  查看所有暂存
• git stash pop            →  恢复最近一次暂存（并删除）
• git stash apply          →  恢复但不删除暂存
• git stash drop           →  删除暂存
• git stash clear          →  清空所有暂存

典型场景：
1. 正在 feature 分支开发，突然要修 main 上的紧急 bug
2. git stash 暂存当前修改
3. git checkout main 修 bug、提交
4. git checkout feature && git stash pop 恢复继续开发

注意：stash 只暂存已追踪文件的修改，新文件需先 git add 才能被 stash。`,
  },
  {
    id: 'git-reset',
    keywords: ['reset', 'git reset', '回退', '撤销提交', 'soft', 'mixed', 'hard', '重置'],
    category: 'git',
    title: '什么是 git reset（重置）？',
    body: `git reset 把当前分支的 HEAD 移动到指定位置，有三种模式：

• --soft   只移动 HEAD，暂存区和工作区不变
  适用：撤销 commit 但保留修改，想重新提交
• --mixed  （默认）移动 HEAD，重置暂存区，工作区不变
  适用：撤销 commit 和 add，但保留修改
• --hard   移动 HEAD，重置暂存区和工作区
  适用：彻底丢弃所有修改（危险！不可恢复）

常用命令：
• git reset --soft HEAD~1     →  撤销最后一次 commit
• git reset --mixed HEAD~1    →  撤销 commit 和 add
• git reset --hard HEAD~1     →  彻底丢弃最后一次 commit
• git reset --hard origin/main →  强制与远程 main 一致

警告：--hard 会丢失未提交的修改，使用前请三思。
已 push 的 commit 不要用 reset，用 revert 代替。`,
  },
  {
    id: 'git-revert',
    keywords: ['revert', 'git revert', '反向提交', '撤销已推送', 'revert vs reset'],
    category: 'git',
    title: '什么是 git revert（反向提交）？',
    body: `git revert 会创建一个新 commit，内容是撤销指定 commit 的修改。

命令：git revert <commit-hash>

与 reset 的区别：
• reset  — 把 HEAD 往回移，会改写历史（适合本地未推送的 commit）
• revert — 新增一个"反向"commit，历史保留（适合已推送的 commit）

示例：
  git revert abc1234
  → 生成一个新 commit，撤销 abc1234 的修改
  → 历史变成：... → abc1234 → revert-abc1234

何时用 revert：
• 已经 push 到远程的 commit（不能用 reset，会破坏他人历史）
• 想保留撤销的痕迹（审计需要）
• 协作分支上撤销修改

多个 commit 撤销：
  git revert abc1234..def5678  →  撤销区间（不含 abc1234，含 def5678）`,
  },
  {
    id: 'git-cherry-pick',
    keywords: ['cherry-pick', 'git cherry-pick', '选择性合并', '摘樱桃', '挑选commit'],
    category: 'git',
    title: '什么是 git cherry-pick（挑选提交）？',
    body: `git cherry-pick 把指定 commit 的修改"复制"到当前分支。

命令：git cherry-pick <commit-hash>

典型场景：
• feature 分支上有一个 bug 修复 commit，想单独合到 main
• 不想合并整个 feature 分支，只想取其中几个 commit

示例：
  git checkout main
  git cherry-pick abc1234   →  把 abc1234 的修改应用到 main

多个 commit：
  git cherry-pick abc1234 def5678 ghi9012
  git cherry-pick abc1234..def5678   →  区间（不含 abc1234）

注意：
• cherry-pick 会生成新的 commit hash（内容相同但 hash 不同）
• 如果冲突，解决后 git cherry-pick --continue
• 不要对已 push 的 commit 做 cherry-pick 到同一分支（会重复）`,
  },
  {
    id: 'git-tag',
    keywords: ['tag', 'git tag', '标签', '版本号', 'release', 'v1.0', '打标签'],
    category: 'git',
    title: '什么是 git tag（标签）？',
    body: `git tag 给特定 commit 打标记，通常用于标记发布版本。

标签类型：
• 轻量标签 — 只是一个指针，git tag v1.0
• 附注标签 — 包含作者、日期、说明信息（推荐）
  git tag -a v1.0 -m "发布版本 1.0"

常用命令：
• git tag                          →  查看所有标签
• git tag v1.0                     →  创建轻量标签
• git tag -a v1.0 -m "说明"         →  创建附注标签
• git tag -a v1.0 abc1234          →  给历史 commit 打标签
• git push origin v1.0             →  推送单个标签
• git push origin --tags           →  推送所有标签
• git tag -d v1.0                  →  删除本地标签
• git push origin :refs/tags/v1.0  →  删除远程标签

版本号规范（语义化版本 SemVer）：
  v主版本.次版本.修订号  例如 v2.1.3
• 主版本 — 不兼容的 API 修改
• 次版本 — 向下兼容的功能新增
• 修订号 — 向下兼容的问题修复`,
  },
  {
    id: 'git-reflog',
    keywords: ['reflog', 'git reflog', '操作历史', '找回commit', '误删恢复', 'HEAD历史'],
    category: 'git',
    title: '什么是 git reflog（操作历史）？',
    body: `git reflog 记录 HEAD 的所有移动历史，是找回误删 commit 的救命稻草。

命令：git reflog

输出示例：
  abc1234 HEAD@{0}: reset: moving to HEAD~1
  def5678 HEAD@{1}: commit: 修复登录bug
  ghi9012 HEAD@{2}: checkout: moving from main to feature

找回误删的 commit：
1. git reflog  →  找到误删前的 commit hash
2. git reset --hard def5678  →  恢复到那个位置

或用 cherry-pick：
  git cherry-pick def5678

注意：
• reflog 是本地的，不会同步到远程
• reflog 默认保留 90 天（可达的 commit），30 天（不可达的）
• git gc 可能清理过期 reflog，误删后尽快恢复

reflog vs log：
• git log  — 查看 commit 历史（分支上的）
• git reflog — 查看 HEAD 移动历史（包括 reset/checkout 等操作）`,
  },
  {
    id: 'git-bisect',
    keywords: ['bisect', 'git bisect', '二分查找', '定位bug', '引入回归', '找bug来源'],
    category: 'git',
    title: '什么是 git bisect（二分查找）？',
    body: `git bisect 用二分法定位是哪个 commit 引入了 bug。

流程：
1. git bisect start                →  开始二分
2. git bisect bad                  →  标记当前 commit 为坏（有 bug）
3. git bisect good v1.0            →  标记 v1.0 为好（无 bug）
4. Git 自动 checkout 中间的 commit
5. 测试这个 commit 是否有 bug
6. git bisect good  或  git bisect bad  →  标记
7. 重复直到 Git 找到引入 bug 的 commit
8. git bisect reset                →  结束

自动二分（需要可执行测试脚本）：
  git bisect start HEAD v1.0
  git bisect run npm test          →  自动跑测试判断好坏

示例场景：
  v1.0 发布时正常，现在发现 bug，中间有 100 个 commit
  用 bisect 只需测试约 7 次（log2(100)）就能定位

适合场景：
• 不知道哪个 commit 引入了回归
• commit 数量多，手动排查太慢
• 有可重复的测试用例`,
  },
  {
    id: 'git-submodule',
    keywords: ['submodule', 'git submodule', '子模块', '嵌套仓库', '子仓库', '依赖仓库'],
    category: 'git',
    title: '什么是 git submodule（子模块）？',
    body: `git submodule 让一个仓库包含另一个仓库，适合管理依赖的外部项目。

添加子模块：
  git submodule add https://github.com/owner/lib.git libs/lib

克隆含子模块的仓库：
  git clone --recurse-submodules https://github.com/owner/repo.git
  # 或分两步：
  git clone https://github.com/owner/repo.git
  git submodule update --init --recursive

更新子模块到最新：
  git submodule update --remote

常见问题：
• 克隆后子模块目录是空的 →  忘了 git submodule update --init
• 子模块指向固定 commit，不会自动更新
• 切换分支后子模块状态可能不一致 →  git submodule update

适用场景：
• 项目依赖外部库（不想用包管理器）
• 多个项目共享同一份代码
• 微服务/组件化架构

注意：submodule 学习成本较高，新手建议优先用包管理器（npm/pip 等）`,
  },
  {
    id: 'git-fetch',
    keywords: ['fetch', 'git fetch', '拉取不合并', 'fetch vs pull', '查看远程更新'],
    category: 'git',
    title: 'git fetch 和 git pull 的区别？',
    body: `git fetch 和 git pull 都从远程获取数据，但行为不同：

git fetch：
• 只下载远程的最新数据
• 不修改工作区，不自动合并
• 安全，可以先看远程有什么变化再决定

git pull：
• = git fetch + git merge
• 下载并自动合并到当前分支
• 可能产生冲突

推荐流程：
1. git fetch origin           →  先获取远程更新
2. git log HEAD..origin/main  →  查看远程比本地多了哪些 commit
3. git diff HEAD origin/main  →  查看具体差异
4. 确认后再 git merge 或 git pull

常用命令：
• git fetch origin                    →  获取 origin 的所有分支
• git fetch origin main               →  只获取 main 分支
• git fetch --all                     →  获取所有远程
• git fetch --prune                   →  清理已删除的远程分支引用

新手建议：用 fetch 代替 pull，先看再合，避免意外冲突。`,
  },

  // ===== 常见报错与解决方案 =====
  {
    id: 'error-push-rejected',
    keywords: ['push rejected', 'non-fast-forward', '推送被拒', '推送失败', 'failed to push', 'updates were rejected'],
    category: 'error',
    title: 'git push 被拒（non-fast-forward）怎么办？',
    body: `错误信息：
  ! [rejected] main -> main (non-fast-forward)
  error: failed to push some refs

原因：远程有你本地没有的 commit（别人先 push 了），直接 push 会覆盖他人历史。

解决方法：

方法 1：先 pull 再 push（推荐）
  git pull origin main
  # 解决冲突（如有）
  git push origin main

方法 2：rebase（历史更线性）
  git pull --rebase origin main
  git push origin main

方法 3：force push（危险！仅限自己的分支）
  git push --force-with-lease origin my-feature
  # --force-with-lease 比 --force 安全，会检查远程是否被他人更新

绝对不要对公共分支（main/develop）用 force push！
那会覆盖他人的提交，引发灾难。

预防：
• 经常 pull 保持本地最新
• push 前先 git fetch 看看远程有没有新 commit`,
  },
  {
    id: 'error-permission-denied-publickey',
    keywords: ['permission denied', 'publickey', 'ssh', '密钥', 'permission denied (publickey)', 'ssh key'],
    category: 'error',
    title: 'Permission denied (publickey) 怎么办？',
    body: `错误信息：
  git@github.com: Permission denied (publickey).
  fatal: Could not read from remote repository.

原因：GitHub 不认识你的 SSH 密钥，无法验证身份。

解决步骤：

1. 检查本地是否有 SSH 密钥
   ls ~/.ssh/id_*.pub
   # 如果没有，生成一个：
   ssh-keygen -t ed25519 -C "your_email@example.com"

2. 启动 ssh-agent 并添加密钥
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519

3. 复制公钥内容
   cat ~/.ssh/id_ed25519.pub
   # 或 Windows: clip < ~/.ssh/id_ed25519.pub

4. 添加到 GitHub
   GitHub → Settings → SSH and GPG keys → New SSH key → 粘贴公钥

5. 测试连接
   ssh -T git@github.com
   # 看到 "Hi username! You've successfully authenticated" 即成功

替代方案：用 HTTPS + Token
  git clone https://github.com/owner/repo.git
  # 用 Personal Access Token 代替密码
  # GitHub → Settings → Developer settings → Personal access tokens

Windows 用户注意：可能需要用 Git Bash 而非 PowerShell 执行 ssh 命令。`,
  },
  {
    id: 'error-unrelated-histories',
    keywords: ['unrelated histories', 'refusing to merge', '不相关历史', 'fatal: refusing to merge unrelated histories'],
    category: 'error',
    title: 'refusing to merge unrelated histories 怎么办？',
    body: `错误信息：
  fatal: refusing to merge unrelated histories

原因：两个仓库的 commit 历史完全没有交集（没有共同祖先）。
常见于：
• 在 GitHub 创建仓库时勾选了 "Initialize with README"，本地已有仓库
• 两个独立创建的仓库想合并

解决方法：
  git pull origin main --allow-unrelated-histories
  # 或
  git merge origin/main --allow-unrelated-histories

然后解决冲突并提交。

预防：
• 本地已有仓库时，GitHub 上创建仓库不要勾选 "Initialize"
• 或先 clone 空仓库，再把本地代码复制进去

注意：--allow-unrelated-histories 会合并两个不相关的历史，
如果不确定为什么要合并，先确认是不是仓库搞错了。`,
  },
  {
    id: 'error-detached-head',
    keywords: ['detached head', '游离head', 'detached HEAD', '头部分离', 'checkout commit'],
    category: 'error',
    title: 'git detached HEAD（游离 HEAD）怎么办？',
    body: `警告信息：
  You are in 'detached HEAD' state. You can look around, make experimental
  changes and commit them, and you can discard any commits you make in this
  state without impacting any branches by switching back to a branch.

原因：HEAD 指向了一个具体的 commit，而不是分支名。
常见于：
• git checkout <commit-hash>  查看历史
• git checkout <tag>          查看某个版本

如果是故意查看历史：
  git checkout main  →  回到分支即可（历史查看结束）

如果在这个状态下做了修改并想保留：
  git branch new-branch-name  →  把当前 commit 保存到新分支
  git checkout new-branch-name

如果误入了 detached HEAD 并提交了：
1. git reflog  →  找到刚才的 commit hash
2. git branch save-my-work <commit-hash>  →  保存到新分支
3. git checkout main
4. git merge save-my-work  →  合并回来

预防：
• 不要在 detached HEAD 状态下做重要修改
• 想基于历史 commit 开发时，先 git checkout -b new-branch <commit>`,
  },
  {
    id: 'error-github-auth',
    keywords: ['authentication', 'token', 'pat', 'personal access token', '密码认证', 'github认证', '403'],
    category: 'error',
    title: 'GitHub 密码认证失败怎么办？',
    body: `错误信息：
  remote: Support for password authentication was removed on August 13, 2021.
  fatal: Authentication failed for 'https://github.com/...'

原因：GitHub 从 2021 年 8 月起不再支持 HTTPS 密码认证，必须用 Token 或 SSH。

方法 1：Personal Access Token（PAT）
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token → 勾选 repo 权限 → 生成
3. 复制 token（只显示一次！）
4. push 时用 token 代替密码

缓存 token（避免每次输入）：
  git config --global credential.helper store      # 明文存储（简单）
  git config --global credential.helper cache      # 内存缓存 15 分钟
  # Windows 推荐用 Git Credential Manager（安装 Git 时默认勾选）

方法 2：SSH 密钥（见 "Permission denied (publickey)" 条目）

方法 3：GitHub CLI
  gh auth login
  # 按提示选择 HTTPS 或 SSH，浏览器授权

token 过期或失效：
• 重新生成 token
• 更新本地缓存（Windows: 控制面板 → 凭据管理器 → Windows 凭据 → 删除 github.com）`,
  },
  {
    id: 'error-merge-conflict',
    keywords: ['merge conflict', '合并冲突', '冲突解决', 'conflict markers', '<<<<<<<', '=======', '>>>>>>>'],
    category: 'error',
    title: '合并冲突怎么解决？',
    body: `冲突标记：
  <<<<<<< HEAD
  你的修改（当前分支）
  =======
  别人的修改（要合并的分支）
  >>>>>>> feature/login

解决步骤：

1. 查看哪些文件冲突
   git status
   # both modified: src/login.js

2. 打开冲突文件，选择保留哪个版本
   • 删除对方的 → 保留 <<<<<<< HEAD 到 ======= 之间
   • 删除自己的 → 保留 ======= 到 >>>>>>> 之间
   • 合并两者 → 手动编辑成正确内容
   • 删除所有冲突标记 <<<<<<< ======= >>>>>>>

3. 标记冲突已解决
   git add src/login.js

4. 继续合并
   git commit   # merge 冲突
   # 或 rebase 冲突：
   git rebase --continue

放弃合并：
  git merge --abort     # 撤销 merge
  git rebase --abort    # 撤销 rebase

工具辅助：
  git mergetool         # 启动可视化合并工具
  # VS Code 内置冲突解决界面（点击 "Accept Current/Incoming/Both"）

预防冲突：
• 经常 git pull 保持最新
• 小步提交，频繁合并
• 团队分工时避免同时改同一文件`,
  },
  {
    id: 'error-npm-install',
    keywords: ['npm install 失败', 'npm err', 'node-gyp', 'peer dependency', 'npm install error', '依赖安装失败'],
    category: 'error',
    title: 'npm install 失败怎么办？',
    body: `常见错误及解决方法：

1. 权限错误（EACCES）
   npm ERR! Error: EACCES: permission denied
   解决：
   • 用 nvm 管理 Node（推荐）
   • 或 npm config set prefix ~/.npm-global
   • 或 sudo npm install（不推荐，Mac/Linux）

2. node-gyp 编译失败
   gyp ERR! find Python Python is not set
   解决：
   • Windows: npm install -g windows-build-tools
   • Mac: xcode-select --install
   • 或用 prebuilt 版本的依赖

3. peer dependency 冲突
   npm ERR! ERESOLVE could not resolve
   解决：
   • npm install --legacy-peer-deps  （npm v7+）
   • 或修复 package.json 中的版本冲突

4. 网络问题
   npm ERR! network timeout
   解决：
   • 换源：npm config set registry https://registry.npmmirror.com
   • 或用 yarn / pnpm

5. 缓存损坏
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install

6. lock 文件冲突
   git pull 后 package-lock.json 冲突
   解决：删除 lock 文件重新生成
   rm package-lock.json && npm install

通用排查：
• 看 npm-debug.log
• 删除 node_modules 重装
• 升级 npm：npm install -g npm@latest`,
  },
  {
    id: 'error-cors',
    keywords: ['cors', '跨域', 'cross-origin', 'blocked by cors', 'access-control-allow-origin'],
    category: 'error',
    title: 'CORS 跨域问题怎么办？',
    body: `错误信息：
  Access to fetch at '...' from origin '...' has been blocked by CORS policy:
  No 'Access-Control-allow-origin' header is present

原因：浏览器同源策略，前端不能直接访问不同域名的 API（除非后端允许）。

解决方法：

1. 后端添加 CORS 头（推荐）
   Access-Control-Allow-Origin: https://your-frontend.com
   Access-Control-Allow-Methods: GET, POST, PUT, DELETE
   Access-Control-Allow-Headers: Content-Type, Authorization

   Express 示例：
   app.use(cors({ origin: 'https://your-frontend.com' }))

2. 开发环境用代理（避免改后端）
   Vite（vite.config.js）：
   server: { proxy: { '/api': 'http://localhost:3000' } }

   Webpack（webpack.config.js）：
   devServer: { proxy: { '/api': 'http://localhost:3000' } }

   Create React App（package.json）：
   "proxy": "http://localhost:3000"

3. JSONP（只支持 GET，已过时）

4. 后端服务器代理（生产环境）
   用 Nginx 反向代理，前端和 API 同域

注意：
• CORS 是浏览器行为，不是后端问题
• Postman / curl 不受 CORS 限制（用于测试 API 是否正常）
• 生产环境应该让前端和 API 同域，或后端正确配置 CORS`,
  },

  // ===== GitHub 进阶功能 =====
  {
    id: 'github-cli',
    keywords: ['gh', 'github cli', 'gh命令', '命令行github', 'gh cli'],
    category: 'github',
    title: '什么是 GitHub CLI（gh）？',
    body: `GitHub CLI（命令 gh）让你在终端直接操作 GitHub，不用开浏览器。

安装：
• Windows: winget install GitHub.cli
• Mac: brew install gh
• Linux: 见 gh 官方文档

登录：
  gh auth login   →  按提示选择 HTTPS/SSH，浏览器授权

常用命令：
• gh repo clone owner/repo        →  克隆仓库
• gh repo create                   →  创建新仓库
• gh repo fork owner/repo          →  Fork 仓库
• gh pr create                     →  创建 PR
• gh pr list                       →  查看 PR 列表
• gh pr checkout 123               →  切到 PR #123 的分支
• gh pr merge 123                  →  合并 PR
• gh issue create                  →  创建 Issue
• gh issue list                    →  查看 Issue
• gh pr checks                     →  查看 CI 检查状态
• gh release create v1.0           →  创建 Release

适合场景：
• 频繁操作 GitHub，不想切浏览器
• 在 SSH/无图形界面环境
• 脚本自动化

新手建议：先掌握 git 基础，再学 gh，能大幅提升效率。`,
  },
  {
    id: 'github-discussions',
    keywords: ['discussions', '讨论区', 'github discussions', '社区讨论', '问答区'],
    category: 'github',
    title: '什么是 GitHub Discussions？',
    body: `GitHub Discussions 是仓库的讨论区，用于问答、想法交流、公告。

与 Issue 的区别：
• Issue — 具体任务（bug 报告、功能请求），有"打开/关闭"状态
• Discussions — 开放讨论（怎么用、最佳实践、想法），无明确结束

适合在 Discussions 发的内容：
• 怎么用这个项目（使用问题）
• 最佳实践讨论
• 项目方向建议
• 展示用项目做的东西
• 公告（维护者发布）

适合在 Issue 发的内容：
• 明确的 bug
• 具体的功能请求
• 文档错误

分类（Categories）：
维护者可设置讨论分类，如：
• Announcements  公告
• General        通用
• Ideas          想法
• Q&A            问答
• Show and tell  展示

新手参与开源：从 Discussions 回答问题开始，门槛低、风险小。`,
  },
  {
    id: 'github-projects',
    keywords: ['projects', 'github projects', '项目管理', '看板', 'kanban', 'projects v2'],
    category: 'github',
    title: '什么是 GitHub Projects？',
    body: `GitHub Projects 是内置的项目管理工具，类似 Trello/Notion 看板。

Projects v2（新版）特点：
• 可跨多个仓库组织 issue
• 支持看板视图、表格视图、路线图视图
• 自定义字段（状态、优先级、日期、迭代等）
• 自动化（如 issue 关闭时自动移动卡片）

创建项目：
  GitHub 头像 → Your projects → New project → 选模板（看板/表格）

添加内容：
• 直接关联仓库的 Issue / PR
• 添加草稿 issue（未关联仓库）
• 拖拽调整状态

典型用法：
• 个人：跟踪自己参与的多个仓库任务
• 团队：跨仓库的迭代规划
• 开源项目：路线图、版本计划

与 Issue 联动：
• Issue 可被添加到多个 Project
• Project 可设置自动化：新 Issue 自动加入"待办"列
• Issue 关闭时自动移到"完成"列

新手：维护者通常会标 good first issue 并加入 Project，你认领后状态会更新。`,
  },
  {
    id: 'github-codespaces',
    keywords: ['codespaces', '云端开发', 'cloud dev', '在线ide', 'github codespaces'],
    category: 'github',
    title: '什么是 GitHub Codespaces？',
    body: `GitHub Codespaces 提供云端开发环境，在浏览器或 VS Code 里直接写代码，不用本地配环境。

特点：
• 基于 Docker 的容器化环境
• 预装项目所需工具链（通过 devcontainer.json 配置）
• 可在浏览器或本地 VS Code 连接
• 免费额度：个人账户每月 120 核小时（2 核机器 60 小时）

使用方式：
1. 仓库页面 → Code 按钮 → Codespaces → Create codespace
2. 等待环境构建（首次几分钟）
3. 在浏览器或 VS Code 中开发

配置文件 .devcontainer/devcontainer.json：
  {
    "image": "mcr.microsoft.com/devcontainers/javascript-node:18",
    "extensions": ["dbaeumer.vscode-eslint"],
    "postCreateCommand": "npm install"
  }

适合场景：
• 快速试用项目，不想本地装环境
• 多设备开发（公司/家里/出差）
• 团队统一开发环境
• 在 PR 上快速验证（直接在 Codespace 里跑）

注意：
• 免费额度有限，不用时记得关
• 私有仓库的 Codespaces 计费不同
• 网络延迟可能影响体验（国内访问 GitHub 慢）`,
  },
  {
    id: 'github-copilot',
    keywords: ['copilot', 'github copilot', 'ai编程', 'ai助手', '代码补全', 'ai pair programming'],
    category: 'github',
    title: '什么是 GitHub Copilot？',
    body: `GitHub Copilot 是基于 AI 的代码补全工具，由 OpenAI 提供。

功能：
• 代码补全：写注释或代码时自动建议
• 整函数生成：写函数签名和注释，自动生成实现
• 多语言支持：Python/JS/Java/Go/Rust 等
• Chat 模式：自然语言问代码相关问题

使用方式：
1. 订阅 Copilot（学生/开源维护者免费）
2. 安装 VS Code / JetBrains 插件
3. 写代码时按 Tab 接受建议

技巧：
• 写清楚的注释，Copilot 建议更准
• 函数名要语义化（如 fetchUserOrders 比 doStuff 好）
• 用 Copilot Chat 问"这段代码做什么""怎么优化"

注意事项：
• Copilot 可能生成过时代码或错误代码，必须 review
• 不要把公司机密代码让 Copilot 学习（有隐私风险）
• 生成的代码要理解后再用，不能盲目复制
• 涉及许可证：Copilot 可能复制开源代码片段，注意许可证兼容

适合场景：
• 写样板代码（CRUD、配置）
• 学新语言/新框架时快速上手
• 写测试用例
• 不适合：核心业务逻辑、安全相关代码`,
  },
  {
    id: 'github-releases',
    keywords: ['release', 'releases', '版本发布', 'github releases', '发布版本', 'changelog'],
    category: 'github',
    title: '什么是 GitHub Releases？',
    body: `GitHub Releases 基于 git tag，提供更丰富的版本发布功能。

与 tag 的区别：
• tag — 只是 commit 的标记（命令行）
• Release — 基于 tag 的发布页面，可附加二进制文件、changelog

创建 Release：
方式 1：网页
  仓库 → Releases → Draft a new release → 选 tag → 填标题和说明 → Publish

方式 2：GitHub CLI
  gh release create v1.0 --title "v1.0" --notes "修复若干 bug"

方式 3：自动生成 changelog
  gh release create v1.0 --generate-notes

Release 内容建议：
• 版本号 + 发布日期
• 新功能列表（Features）
• 修复列表（Bug Fixes）
• 破坏性变更（Breaking Changes）
• 升级指南
• 下载链接（附加二进制文件）

自动化发布：
• GitHub Actions 触发（push tag 时自动创建 Release）
• 用 release-drafter 自动生成 changelog
• 语义化版本 + conventional commits 自动版本号

用户视角：
• 在 Release 页面下载特定版本
• 查看 changelog 决定是否升级
• 订阅 Release 通知（Watch → Custom → Releases）`,
  },
  {
    id: 'github-dependabot',
    keywords: ['dependabot', '依赖更新', '依赖安全', 'dependency update', '安全更新', '漏洞修复'],
    category: 'github',
    title: '什么是 Dependabot？',
    body: `Dependabot 是 GitHub 内置的依赖管理机器人，自动检测依赖更新和安全漏洞。

两种功能：

1. Dependabot Alerts（安全警报）
• 扫描 package.json / requirements.txt 等依赖文件
• 发现已知漏洞时通知仓库管理员
• 在 Security 标签页查看
• 默认开启（公开仓库）

2. Dependabot Version Updates（版本更新）
• 自动创建 PR 升级依赖
• 配置文件 .github/dependabot.yml
• 可设置检查频率（daily/weekly/monthly）

配置示例：
  version: 2
  updates:
    - package-ecosystem: "npm"
      directory: "/"
      schedule:
        interval: "weekly"
    - package-ecosystem: "pip"
      directory: "/"
      schedule:
        interval: "monthly"

收到 Dependabot PR 后：
1. 查看 changelog 确认无破坏性变更
2. 跑测试
3. 合并或关闭

新手建议：
• 公开仓库默认开启 Alerts
• Version Updates 可选，但推荐开启
• 不要忽略 Dependabot PR，安全漏洞要尽快修
• 合并前一定要跑测试，依赖升级可能引入兼容性问题`,
  },
  {
    id: 'github-sponsors',
    keywords: ['sponsors', '赞助', 'github sponsors', '资助开源', '捐赠', 'sponsor'],
    category: 'github',
    title: '什么是 GitHub Sponsors？',
    body: `GitHub Sponsors 是 GitHub 的开源赞助平台，让开发者能获得经济支持。

对赞助者：
• 浏览 github.com/sponsors 发现可赞助的开发者
• 选择赞助等级（月付/一次性）
• 可通过公司账户赞助（可开发票）
• 赞助金额 GitHub 不抽成（0% 手续费）

对被赞助者：
• 申请条件：居住在支持地区、2FA、GitHub 账号 60 天+
• 设置赞助等级和回报（如代码 review、专属频道）
• 收款方式：Stripe（支持银行转账）
• 税务：根据所在国家处理

赞助等级示例：
• $2/月 — 鸣谢列表
• $10/月 — 优先回复 Issue
• $50/月 — 每月 1 小时咨询
• $500/月 — 公司 logo 展示

公司赞助：
• GitHub Sponsors for Companies
• 可作为开源预算的一部分
• 部分公司有匹配捐赠计划

新手视角：
• 用开源项目时，考虑赞助维护者
• 不一定要钱，也可以通过 PR/Issue/文档贡献
• 成为维护者后，可申请 Sponsors 获得收入`,
  },

  // ===== 开源进阶 =====
  {
    id: 'oss-cla',
    keywords: ['cla', 'contributor license agreement', '贡献者协议', 'cla签署', '贡献协议'],
    category: 'oss',
    title: '什么是 CLA（贡献者协议）？',
    body: `CLA（Contributor License Agreement）是贡献者签署的协议，授予项目方使用你贡献代码的权利。

为什么需要 CLA：
• 明确贡献代码的版权归属
• 防止未来版权纠纷
• 让项目方能重新授权（如改许可证）
• 大型项目（Kubernetes、Apache）通常要求

与 DCO 的区别：
• CLA — 正式协议，可能涉及专利、商标等
• DCO — 简单声明，只需 commit 加 Signed-off-by

签署流程：
1. 提交第一个 PR 时，机器人（如 cla-assistant）会评论要求签署
2. 点击链接，阅读 CLA 内容
3. 电子签名（通常勾选 + 填姓名邮箱）
4. 之后所有贡献都受该 CLA 约束

常见项目要求：
• Google 项目（TensorFlow、Angular）— 需签署 Google CLA
• Apache 软件基金会 — 需签署 Apache CLA
• Kubernetes — 需签署 CNCF CLA
• 个人项目 — 通常不需要

新手注意：
• 签 CLA 前要读清楚条款（尤其是专利条款）
• 公司员工贡献可能需要公司授权
• 不签 CLA 的 PR 不会被合并
• CLA 是法律文件，不确定时咨询法务`,
  },
  {
    id: 'oss-dco',
    keywords: ['dco', 'developer certificate of origin', 'signed-off-by', 'dco签署', 'origin认证'],
    category: 'oss',
    title: '什么是 DCO（开发者原产地证明）？',
    body: `DCO（Developer Certificate of Origin）是轻量级的贡献声明，确认你有权提交这段代码。

形式：在 commit message 末尾加一行
  Signed-off-by: Your Name <your.email@example.com>

命令：
  git commit -s -m "fix: 修复登录bug"
  # -s 自动添加 Signed-off-by

DCO 声明的内容（简化版）：
• 这段代码是我自己写的，或我有权提交
• 代码来源合法，不侵犯他人版权
• 我允许项目方按其许可证使用

与 CLA 的区别：
• DCO — 每个 commit 单独声明，轻量
• CLA — 一次性签署完整协议，重量级

要求 DCO 的项目：
• Linux 内核（DCO 的发源地）
• Git 本身
• 许多 Linux 基金会项目

检查 DCO：
• 项目通常用 DCO bot 检查 PR 中所有 commit 是否有 Signed-off-by
• 缺失时 PR 会被标记为 pending
• 补救：git rebase --signoff HEAD~N

新手注意：
• 贡献前看 CONTRIBUTING.md 是否要求 DCO
• 用 git commit -s 习惯性加上
• 如果 PR 被机器人拦下，按提示补 Signed-off-by`,
  },
  {
    id: 'oss-semver',
    keywords: ['semver', 'semantic versioning', '语义化版本', '版本号规范', 'major minor patch'],
    category: 'oss',
    title: '什么是语义化版本（SemVer）？',
    body: `SemVer（Semantic Versioning）是版本号规范，格式：MAJOR.MINOR.PATCH

例如 v2.1.3：
• MAJOR = 2  主版本号
• MINOR = 1  次版本号
• PATCH = 3  修订号

版本号递增规则：
• MAJOR — 不兼容的 API 修改（破坏性变更）
• MINOR — 向下兼容的功能新增
• PATCH — 向下兼容的问题修复

预发布版本：
  v1.0.0-alpha  v1.0.0-beta  v1.0.0-rc.1
  比 v1.0.0 优先级低

构建元数据：
  v1.0.0+20230101  v1.0.0+exp.sha.5114f85
  不影响版本优先级

版本范围（package.json）：
• ^1.2.3  →  >=1.2.3 <2.0.0  （允许 minor 和 patch 升级）
• ~1.2.3  →  >=1.2.3 <1.3.0  （只允许 patch 升级）
• 1.2.3   →  精确版本
• *       →  任意版本

为什么用 SemVer：
• 自动化工具能判断是否可安全升级
• ^1.2.3 升级到 1.3.0 应该是安全的（兼容）
• 1.x 升级到 2.0 要小心（可能不兼容）

新手建议：
• 自己的项目从 v0.1.0 开始（0.x 表示不稳定）
• v1.0.0 表示 API 稳定，可生产使用
• 破坏性变更要升 MAJOR，不要只升 MINOR`,
  },
  {
    id: 'oss-conventional-commits',
    keywords: ['conventional commits', '约定式提交', 'commit规范', 'feat fix', 'commit message规范'],
    category: 'oss',
    title: '什么是 Conventional Commits（约定式提交）？',
    body: `Conventional Commits 是 commit message 规范，让 commit 历史可读、可自动生成 changelog。

格式：
  <type>(<scope>): <description>

  [optional body]

  [optional footer(s)]

类型（type）：
• feat     新功能
• fix      修复 bug
• docs     文档变更
• style    代码格式（不影响功能）
• refactor 重构（既不是 feat 也不是 fix）
• perf     性能优化
• test     添加/修改测试
• build    构建系统或外部依赖变更
• ci       CI 配置变更
• chore    杂项（不修改 src 或测试）
• revert   撤销 commit

示例：
  feat(auth): 添加 OAuth2 登录
  fix(api): 修复 404 错误
  docs(readme): 更新安装说明
  refactor(utils): 提取公共函数
  BREAKING CHANGE: 移除 deprecated API

破坏性变更标记：
• 在 footer 加 BREAKING CHANGE: 说明
• 或在 type 后加 !：feat!: 移除旧 API

好处：
• 自动生成 changelog（用 semantic-release 等工具）
• 自动决定下一版本号（feat → MINOR，fix → PATCH，BREAKING → MAJOR）
• commit 历史清晰，便于回溯

工具：
• commitizen — 交互式生成规范 commit
• commitlint — 检查 commit 是否符合规范
• semantic-release — 自动版本发布

新手建议：
• 看项目 CONTRIBUTING.md 是否要求此规范
• 不确定时，feat/fix/docs 三个最常用`,
  },
  {
    id: 'oss-governance',
    keywords: ['governance', '治理模式', 'bdfl', '精英制', '基金会', 'meritocracy', '项目治理'],
    category: 'oss',
    title: '开源项目有哪些治理模式？',
    body: `开源项目的治理模式决定了"谁有决策权"。

常见模式：

1. BDFL（Benevolent Dictator For Life，终身仁慈独裁者）
• 一人有最终决策权
• 例子：Linux（Linus Torvalds）、Python（Guido van Rossum，已退）
• 优点：决策快、方向一致
• 缺点：依赖个人，独裁风险

2. 精英制（Meritocracy）
• 贡献越多权力越大
• 由 committer 投票决定
• 例子：Apache 软件基金会、Mozilla
• 优点：激励贡献、决策有依据
• 缺点：可能形成"老男孩俱乐部"

3. 基金会托管
• 项目归属基金会（如 CNCF、Linux Foundation）
• 基金会提供法律、财务支持
• 技术决策由维护者委员会做出
• 例子：Kubernetes（CNCF）、Node.js（OpenJS）

4. 公司主导
• 一家公司控制项目
• 例子：React（Meta）、Angular（Google）、.NET（Microsoft）
• 优点：资源充足
• 缺点：可能偏向公司利益

5. 分布式共识
• 无明确领导，社区共识驱动
• 罕见，适合小项目

新手视角：
• 看项目 GOVERNANCE.md 了解治理结构
• 大型项目通常有明确的晋升路径（Contributor → Committer → Maintainer）
• 不同模式影响你如何参与和晋升
• 公司主导项目要关注其商业意图`,
  },
  {
    id: 'oss-responsible-disclosure',
    keywords: ['responsible disclosure', '负责任披露', '安全漏洞', 'security advisory', '漏洞报告', 'cve'],
    category: 'oss',
    title: '什么是安全漏洞负责任披露？',
    body: `负责任披露（Responsible Disclosure）指发现漏洞后，先私下通知维护者，等修复后再公开。

流程：
1. 发现漏洞
2. 私下联系维护者（不要公开 Issue！）
3. 提供详细报告（复现步骤、影响范围）
4. 等待维护者修复（通常 90 天）
5. 修复后公开披露（CVE + 公告）

如何报告漏洞：
• GitHub Security Advisories（仓库 → Security → Advisories）
• 项目指定的安全邮箱（如 security@example.com）
• CVE 数据库（cve.mitre.org）

GitHub Security Advisory：
1. 仓库 → Security → Security advisories → New draft security advisory
2. 填写漏洞详情、影响版本
3. 协作修复
4. 发布后可申请 CVE 编号

注意事项：
• 不要在公开 Issue 报告漏洞
• 不要在社交媒体公开未修复漏洞
• 不要利用漏洞获取数据或破坏
• 给维护者合理时间修复（通常 90 天）

漏洞悬赏：
• 部分项目有奖金（GitHub Security Lab、HackerOne）
• 大公司（Google、Microsoft）有正式悬赏计划
• 报告前看项目是否有悬赏政策

新手建议：
• 发现疑似漏洞先私下联系
• 不确定是否算漏洞时，也先私下问
• 不要为了"出名"抢先公开`,
  },

  // ===== 开发工作流概念 =====
  {
    id: 'workflow-branch-strategies',
    keywords: ['gitflow', 'github flow', 'trunk-based', '分支策略', '分支模型', '工作流对比'],
    category: 'workflow',
    title: 'GitFlow / GitHub Flow / Trunk-based 有什么区别？',
    body: `三种主流的分支策略：

1. GitFlow（复杂，适合发布周期长的项目）
• 分支：main / develop / feature / release / hotfix
• develop 是日常开发主线
• feature 分支开发新功能，合并回 develop
• release 分支准备发布，合并到 main 和 develop
• hotfix 紧急修复 main，合并到 main 和 develop
• 适合：有明确版本发布的产品（如桌面软件）

2. GitHub Flow（简单，适合 Web/SaaS）
• 只有 main + feature 分支
• main 始终可部署
• feature 分支开发，PR 合并回 main
• 合并后立即部署
• 适合：持续部署的 Web 应用（GitHub 自己用）

3. Trunk-based Development（极简，适合高频部署）
• 所有人直接提交到 main（或短命 feature 分支）
• 用 feature flag 控制功能开关
• 频繁集成（每天多次）
• 适合：CI/CD 成熟、需要快速迭代的团队（Google、Facebook）

对比：
| 维度       | GitFlow       | GitHub Flow | Trunk-based |
|-----------|---------------|-------------|-------------|
| 复杂度     | 高            | 中          | 低          |
| 发布频率   | 低（周/月）   | 中（天）    | 高（小时）  |
| 分支数     | 多            | 少          | 极少        |
| 适合       | 版本化产品    | Web 应用    | 高频部署    |

新手建议：
• 开源项目通常用 GitHub Flow
• 看 CONTRIBUTING.md 了解项目的分支策略
• 不要在 main 直接提交，建 feature 分支`,
  },
  {
    id: 'workflow-ci-cd',
    keywords: ['ci', 'cd', '持续集成', '持续部署', 'ci/cd', 'continuous integration', 'continuous deployment'],
    category: 'workflow',
    title: '什么是 CI/CD？',
    body: `CI/CD 是自动化软件开发流程的实践。

CI（Continuous Integration，持续集成）：
• 代码 push / PR 时自动跑测试
• 早发现集成问题
• 保持 main 分支稳定
• 工具：GitHub Actions、Jenkins、CircleCI

CD（Continuous Delivery/Deployment，持续交付/部署）：
• Continuous Delivery — 自动准备发布，人工触发部署
• Continuous Deployment — 自动部署到生产
• 工具：GitHub Actions、ArgoCD、Spinnaker

CI/CD 流程示例：
1. 开发者 push 代码
2. CI 触发：lint → test → build
3. PR 自动检查通过 → 允许合并
4. 合并到 main → CD 触发
5. 自动部署到 staging → 测试 → 生产

GitHub Actions 示例（.github/workflows/ci.yml）：
  name: CI
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v3
        - run: npm install
        - run: npm test

新手视角：
• PR 上的绿色对勾 = CI 通过
• 红色叉号 = CI 失败，要修
• CI 失败时点进去看日志，定位问题
• 不要忽略 CI 失败就合并

常见 CI 检查：
• 代码风格（ESLint、Prettier）
• 类型检查（TypeScript、mypy）
• 单元测试
• 构建测试
• 安全扫描`,
  },
  {
    id: 'workflow-code-quality',
    keywords: ['linter', 'formatter', 'eslint', 'prettier', '代码质量', '代码风格', 'lint'],
    category: 'workflow',
    title: '什么是 Linter 和 Formatter？',
    body: `Linter 和 Formatter 是保证代码质量的工具。

Linter（代码检查器）：
• 检查代码潜在问题（未使用变量、隐式全局等）
• 检查代码风格（缩进、引号）
• 常见：ESLint（JS）、pylint（Python）、golangci-lint（Go）

Formatter（代码格式化）：
• 自动调整代码格式（缩进、换行、空格）
• 不检查逻辑，只管样式
• 常见：Prettier（多语言）、black（Python）、gofmt（Go）

区别：
• Linter — 找问题，可能报错让你改
• Formatter — 直接改格式，不报错

ESLint 配置示例（.eslintrc.json）：
  {
    "extends": ["eslint:recommended"],
    "rules": {
      "no-unused-vars": "error",
      "indent": ["error", 2]
    }
  }

Prettier 配置（.prettierrc）：
  {
    "semi": false,
    "singleQuote": true,
    "tabWidth": 2
  }

集成到开发流程：
• 编辑器保存时自动格式化（VS Code 插件）
• git pre-commit hook（husky + lint-staged）
• CI 检查（PR 不符合规范则失败）

新手建议：
• 跟着项目现有配置走，不要自己改规则
• 装 VS Code 的 ESLint 和 Prettier 插件
• 保存时自动格式化能省很多事
• CI 报 lint 错误时，看提示修，不要 --no-verify 跳过`,
  },
  {
    id: 'workflow-testing',
    keywords: ['testing', '测试', 'unit test', 'integration test', 'e2e', '单元测试', '集成测试'],
    category: 'workflow',
    title: '什么是单元测试、集成测试、E2E 测试？',
    body: `三种测试层次，从细到粗：

1. 单元测试（Unit Test）
• 测试单个函数/模块
• 隔离依赖（mock）
• 快速、数量多
• 工具：Jest、Vitest、pytest、Go test
• 示例：测试 add(1,2) 是否返回 3

2. 集成测试（Integration Test）
• 测试多个模块协作
• 可能连真实数据库
• 较慢、数量中等
• 工具：Jest、pytest、Testcontainers
• 示例：测试 API 端点能否正确读写数据库

3. E2E 测试（End-to-End）
• 模拟用户操作整个应用
• 启动完整环境（前端+后端+数据库）
• 最慢、数量少
• 工具：Playwright、Cypress、Selenium
• 示例：测试用户登录→下单→支付的完整流程

测试金字塔：
      /  E2E  \        少
     / 集成测试 \      中
    /  单元测试   \    多

Jest 单元测试示例：
  test('add 1 + 2 = 3', () => {
    expect(add(1, 2)).toBe(3)
  })

Playwright E2E 示例：
  test('用户登录', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', 'test@example.com')
    await page.click('button[type=submit]')
    await expect(page).toHaveURL('/dashboard')
  })

新手建议：
• 优先写单元测试（性价比最高）
• 核心业务逻辑必须有测试
• E2E 测试覆盖关键用户流程即可
• CI 跑测试，失败必须修
• 测试覆盖率不是越高越好，关键路径覆盖即可`,
  },
  {
    id: 'workflow-monorepo',
    keywords: ['monorepo', 'polyrepo', '单仓库', '多仓库', 'monorepo vs polyrepo', '仓库组织'],
    category: 'workflow',
    title: 'Monorepo 和 Polyrepo 有什么区别？',
    body: `两种代码仓库组织方式：

Monorepo（单仓库）：
• 多个项目/模块放在一个仓库
• 例子：Google、Meta、Babel、React
• 工具：Nx、Turborepo、Lerna、pnpm workspaces

Polyrepo（多仓库）：
• 每个项目一个仓库
• 例子：传统开源项目（Vue、React 组件库各自仓库）

Monorepo 优点：
• 代码共享简单（直接 import）
• 原子提交（一次 PR 改多个包）
• 统一工具链和配置
• 依赖管理集中

Monorepo 缺点：
• 仓库大，clone 慢
• 权限管理粗（所有人能看所有代码）
• CI 可能慢（需要增量构建优化）
• 工具复杂（需要 Nx/Turborepo 等）

Polyrepo 优点：
• 仓库小、独立
• 权限清晰
• CI 简单

Polyrepo 缺点：
• 跨仓库改动麻烦（多个 PR）
• 依赖共享复杂（发 npm 包）
• 工具链可能不统一

Monorepo 工具：
• pnpm workspaces — 简单、快
• Nx — 功能全、有依赖图
• Turborepo — Vercel 出品、快
• Lerna — 老牌、维护慢

适合 Monorepo 的场景：
• 公司内部多个相关项目
• 组件库 + 文档站 + 示例
• 微服务架构

新手建议：
• 个人项目用 Polyrepo 即可
• 看项目结构判断是否 Monorepo（多个 package.json）
• Monorepo 项目贡献时，注意改动的范围
• 用 pnpm install 而非 npm install（Monorepo 友好）`,
  },
]

/**
 * 检索知识库 — 关键词匹配 + 相关性排序
 * @param {string} query 用户问句
 * @param {number} topN 返回最多结果数
 * @returns {Array<{id, title, body, score, category}>}
 */
export function searchKnowledge(query, topN = 3) {
  const q = query.toLowerCase()
  const scored = KB.map(entry => {
    let score = 0
    // 匹配关键词
    for (const kw of entry.keywords) {
      if (q.includes(kw.toLowerCase())) {
        score += 10
      }
    }
    // 匹配标题
    if (entry.title.toLowerCase().includes(q)) score += 5
    // 匹配分类
    if (entry.category.toLowerCase().includes(q)) score += 3
    return { ...entry, score }
  })
  const matched = scored.filter(e => e.score > 0)
  matched.sort((a, b) => b.score - a.score)
  return matched.slice(0, topN).map(({ id, title, body, category, score }) => ({
    id, title, body, category, score,
  }))
}

/** 获取所有知识分类 */
export function getKnowledgeCategories() {
  const cats = {}
  KB.forEach(e => {
    if (!cats[e.category]) cats[e.category] = 0
    cats[e.category]++
  })
  return Object.entries(cats).map(([key, count]) => ({ key, count }))
}

/** 知识库总条目数 */
export const KB_SIZE = KB.length

/** 导出知识库原始数据（RAG 索引用） */
export { KB }