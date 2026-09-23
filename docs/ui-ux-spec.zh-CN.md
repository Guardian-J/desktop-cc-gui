# CC GUI 界面与交互规范（UI/UX Spec）

> **版本**：v0.1（首版，随实现增量维护）
> **适用范围**：`src/styles`、`src/components`、`src/features` 中所有用户可见的界面与交互
> **关联代码**：`src/styles/theme.css`（设计 token）、`src/styles/typography.css`（文本样式）、`src/components/base/*`（基础组件）、`src/i18n/{zh,en}.ts`（文案）

这是本项目界面与交互的**唯一约定来源**。凡是"两个地方长得不一样、动得不一样"的问题，先在这里定一条规则，再改代码；代码里出现的做法如果值得复用，就回写成规则。

文档只写**已经落地、能指到代码**的规则；暂时做不到的放进 [§8 待收敛](#8-待收敛)，不假装成立。

---

## 目录

1. [维护约定](#1-维护约定)
2. [设计基础](#2-设计基础)
3. [状态与可用性](#3-状态与可用性)
4. [动作反馈](#4-动作反馈)
5. [加载、空状态与错误](#5-加载空状态与错误)
6. [破坏性操作](#6-破坏性操作)
7. [刷新入口清单](#7-刷新入口清单)
8. [待收敛](#8-待收敛)

---

## 1. 维护约定

- **谁改谁更新**：新增或修改用户可见的交互反馈、基础组件视觉、动效时长时，在同一个提交里更新本文对应章节。
- **新增刷新/重载入口必须登记**到 [§7 刷新入口清单](#7-刷新入口清单)；没登记的算没做完。
- **规则要能落到代码**：每条规则写清文件和常量名。文档与代码冲突时**以代码为准**，并立即修正文档（或反过来改代码 + 补充说明）。
- 只维护这一份中文文档，不再派生第二份双语副本，避免两边漂移。
- 规则来自真实问题，不预先发明：同一条规则第二次被违反时，才值得写进来。

## 2. 设计基础

### 2.1 Token 优先

- 颜色、圆角、阴影、动效一律引用 `src/styles/theme.css` 的**语义 token**（`text-*`、`background-*`、`border-*`、`foreground-icon-*`、`notification-*`、`shadow-*`），不写死色值、不直接引用 `slate-*` 之类的原始色阶。
- 文本排版用 `src/styles/typography.css` 的 `text-*` 系列（`text-body-medium`、`text-caption-1-regular`…）。`cx()` 依赖 `src/utils/cx.ts` 里登记过的文本族，新增文本族必须同步登记，否则会被 tailwind-merge 当成颜色丢掉。
- 关键帧动画定义在 `src/styles/theme.css` 的 `@theme` 里（如 `--animate-refresh-spin`）并配 `@keyframes`，组件只引用动画名。

### 2.2 组件优先

- 交互控件优先复用 `src/components/base/*`（`Button`、`IconButton`、`Dropdown`、`Select`、`Input`、`Switch`、`Tooltip`…）。页面内自造按钮要么说明 base 组件为什么不适用，要么把它沉淀成 base 组件。
- 尺寸以组件自身定义为准，不在调用点临时改高度：`Button` medium 36 / small 32 / xs 24，`IconButton` medium 36 / small 32。
- `Button` / `IconButton` 需要承载动态图标时用 `children` 覆盖默认图标（两者同一契约），不要用 `[&_svg]:animate-spin` 这类穿透选择器改图标行为。
- 图标一律取 `lucide-react/dist/esm/icons/*`（按需具名导入）；不新引图标库，也不自绘 SVG。同一入口出现在多个位置时三处共用同一个图标：插件/插件市场 = `layout-grid`（侧边栏 `sidebar-chrome.tsx`、插件中心页签 `use-chat-tabs.ts`、设置页插件条目无品牌素材时的兜底 `PluginSettingsNavIcon.tsx`）。

### 2.3 文案与无障碍

- 用户可见文案一律从 `src/i18n/zh.ts`、`src/i18n/en.ts` 取，两个语言文件同步新增 key，组件里不写死中文。
- 图标按钮必须同时有 `aria-label`（可访问名）和 `title`（指针悬停）。可访问名用**动作名**（"刷新"、"重新加载"），不用"点这里"。
- 需要解释性文案、快捷键或多行说明时才用 `Tooltip`（`src/components/base/tooltip/tooltip.tsx`）：它基于 react-aria，trigger 必须是 react-aria 组件或包在 `Focusable` 里的元素；触屏上不可达，所以**关键信息不能只放在 tooltip 里**。

## 3. 状态与可用性

- **插件会话模式**：获得 `ui:conversation-mode` 授权后，在 CLI 选择器旁提供入口，不伪装成 CLI 或权限选项；普通轮次或发送队列未结束时禁止切入。模式替换当前聊天内容区与输入框，保留原普通对话。运行、取消待确认及恢复待核对期间禁止通过宿主「返回普通对话」绕过插件的退出锁。
- **接力首版**：规划与执行分别配置引擎 / 渠道 / 模型，配置浮层限高滚动且动作区保持可见。允许多轮讨论和手工编辑，每份完整计划保存为新版本；只有最新、已保存、无未解问题且无未发送草稿的计划可点击「确认此版并执行」。普通发送、AI 回复结束和保存编辑均不授权执行。确认冻结交接包，执行新建原生会话；历史版本只读。
- **接力停止与恢复**：停止是请求取消，不是回滚；等待进程终态才结束忙碌状态，失败不自动重试写入。重新打开已保存接力记录先核对上次进程及工作区，不自动续跑。明确披露记录独立于普通聊天、其他会话与外部编辑器不受接力单任务锁保护。

- 可交互元素至少实现：默认 / hover / `focus-visible`（`ring-border-focus-ring`）/ active / disabled。按钮类控件的焦点环只走 `focus-visible`（不打扰鼠标用户）；输入类控件可以用 `focus:border-border-focus-ring` 表示聚焦，因为文本输入聚焦本身就是用户意图。
- disabled 必须改变光标语义（`disabled:cursor-not-allowed` 或 `disabled:cursor-default`）并降低强调（`opacity-50`~`60` 或语义 disabled token），不能只是点不动。
- **异步动作进行中不可重入**：进行中禁用按钮（或首行拦截 `if (running) return`），避免重复请求。
- **反馈不改变布局**：图标在默认态与反馈态之间切换时，外层容器尺寸固定（`ActionFeedbackIcon` 用 `iconClassName` 同时约束容器和图标），按钮不能因为换图标而抖动。
- **动效可降级**：过渡类一律带 `motion-reduce:transition-none`；关键帧动画的降级见 [§8](#8-待收敛)。
- **同一状态只表达一次**：列表行里「已安装 / 可更新」只给一个信号——市场表的右侧按钮就是该行的状态（`安装` → `更新至 vX` → `已安装`），行内不再重复挂徽标；安装中按钮原地换成进度（`plugins.installingPct`）且保持占位不變（`PluginMarketRow.tsx`）。
- **表格化列表**：插件市场用语义 `<table>` + `table-fixed`，列头是唯一的字段说明（名称 / 开发者 / 安装量 / 版本 / 操作）；整列无数据时整列不渲染（`PluginMarketView` 的 `showDownloads`），不用一列「—」占位。开发者列的头像是该账号的真实 GitHub 头像（`githubAvatarUrl`），加载中或取不到时回落到同一配色的首字母瓷砖，不出现破图。
- **官方身份用紫色品牌徽标，工具栏下拉同时承担人群范围**：市场表开发者列在 `githubLoginFor` 解析出的账号等于官方账号时（`isOfficialPlugin`，账号 `zhukunpenglinyutong`，author 或 repo owner，大小写不敏感），整格只渲染紫色「CCGUI官方插件」徽标（`status-purple-background` / `status-purple-text`；紫色专属官方，不与中性类型徽标、lime「已安装」混用）——官方插件的账号是隐含信息，不再重复头像与（被截断的）用户名；详情页右栏 `AuthorChip` 同一条判定，徽标整块是按钮（`title` 报出目标主页），点击打开该官方账号主页，第三方插件才展示可点的头像+名称。工具栏下拉（`sortLabel`）语义混合：`综合排序` / `下载量` 显示全部、只是排序不同；`CCGUI官方插件` / `社区插件` 只保留该类并按下载量排序（`sortPlugins` 内 `pluginMatchesAudience`）。空状态的「清除筛选」要把下拉一并复位回 `综合排序`。
- **开发者只在能落到真实账号时可点**：插件详情页右栏的「开发者」用 `githubLoginFor({ author, repo })` 判定身份——索引 `author` 是 GitHub 账号（或回落到 repo owner）时，整块头像+名称是可点按钮，点击走 `openExternal` 打开 `https://github.com/<login>`，并把目标主页写进 `title`；官方徽标同理指向 `OFFICIAL_PLUGIN_LOGIN`；解析不出账号时保持纯文本，不猜主页地址（`PluginDetailPage.tsx` 的 `AuthorChip`）。
- **带背景的块在 flex 列里必须自适应宽度**：右信息栏 `RailRow` 是 `flex flex-col`，默认 `align-items: stretch` 会把任何块拉伸到整栏宽——带背景的徽标不加 `w-fit` 就变成整行色块。所以 `OFFICIAL_BADGE` 带 `w-fit`，可点的头像+名称块用 `flex w-fit max-w-full`。长文本靠内层 `truncate` 收窄，不靠父级的拉伸。
- **时间只说数据源里有的**：插件详情页右栏的「最近更新时间」只取索引 `plugins/<id>.json` 的 `updatedAt`（上游 Release 发布时间，`indexUpdatedAt` 解析后按当前语言格式化）；条目没有该字段就不渲染这一行，不用本机安装时间顶替，也不用「—」占位。
- **插件素材可选、缺失不占位**：插件图标取索引 `icon`（市场行、详情页头部、已安装行共用 `PluginAvatar`），加载中或取不到时回落同一 id 的确定性渐变首字母瓷砖；详情页效果图取索引 `screenshots`，空数组整个图集不渲染（`PluginScreenshotCarousel`），单张加载失败只在该槽位显示占位文案。不出现破图，也不用「—」占位。
- **大图预览必须有三条出路**：截图放大层（`PluginScreenshotCarousel` 的 lightbox，走 `ModalShell`）同时支持点空白背景、按 Escape、点右上角 `X`（`fixed right-5 top-5` 的 36px 圆形浮标，`aria-label` / `title` 为「关闭大图」）关闭。背景点击依赖 `ModalShell` 把 `isDismissable` 写在 `ModalOverlay` 上：react-aria 的 `useOverlay` 默认 `isDismissable = false`，`useModalOverlay` 只读 ModalOverlay 的同名属性，写在里层 `Modal` 上会被忽略（开发态有警告），表现为「点空白关不掉」。`X` 锚在视口角而不是图片角：效果图宽高比不定，锚图片要么盖住角落内容，要么随图片漂移。回归：`PluginScreenshotCarousel.test.tsx`。
- **插件面板页签只给图标**：聊天右侧面板页签条（`ChatPanelHeader.tsx`）里，插件页签（registry id 前缀 `plugin:`）只在 `PillTab` 的图标槽渲染 16px 图标，插件自报的 `label` 只作 `title` 与 `aria-label`（指针悬停 / 读屏可见，页签条里不占文字宽）；内建「文件 / 变更」保留图标+文字。插件没注册 `icon` 时回落同一插件素材（manifest 图标经 `plugin_read_artwork` → 市场安装会把索引品牌图按该相对路径落到插件目录，离线可用）→ 确定性渐变首字母瓷砖，与插件市场同一条链（`PluginPanelTabIcon.tsx`）。
- **设置页插件条目用插件自己的品牌图**：设置页导航（`SettingsPage.tsx`）里每个插件 section（registry id 前缀 `plugin:`）的 16px 图标，插件注册了 `icon` 就用它；没注册时回落该插件 manifest 的 `icon`（经 `plugin_read_artwork`，与面板页签、插件市场同一条素材链），只有插件没有品牌素材时才用共用的 `layout-grid` 兜底。这里不画市场同款渐变首字母瓷砖：导航栏其他行的图标都是单色 lucide，彩色瓷砖会喧宾夺主，没有真实素材时中性宫格才是这一列的基调（`PluginSettingsNavIcon.tsx`）。回归：`SettingsPage.test.tsx`。
- **页头文字按钮的两种禁用分开**：插件中心页头（`PluginHub.tsx`）同一种文字按钮分两个禁用语义——「进行中」用 `disabled:cursor-wait`（`HEADER_BUTTON_BUSY`），「前提不满足」用 `disabled:cursor-not-allowed` + `opacity-50`（`HEADER_BUTTON_BLOCKED`），且后者必须给 `title` 说明缺什么（如「创建插件」在没有工作区时不可点）。等待态不能用来表达「你还没准备好前提」。
- **跳转后必须真的给光标**：从插件中心/浏览器/文件切回聊天（「创建插件」「新建会话」）时，输入框要真的获得焦点——中心面用 `.invisible` 切换，隐藏元素上的 `focus()` 会被浏览器静默忽略（fixture 实测：切换到可聚焦要 ~250ms）；统一走 `src/features/chat/focus-composer.ts`，它在时间窗内逐帧重试，并在焦点落到可见输入框时立即停手。**预填草稿的光标由我们自己落位**：草稿恢复会重建 editable 的 DOM，浏览器手里的插入点随之消失，随后 `focus()` 会把光标搁回内容开头；`Composer` 的外部 value 同步（`replaceEditableText`）在重建后把插入点放到文本末尾，用户可直接接着敲需求。回归：`tests/browser/creator-jump.html`（断言输入框内容是预填原文、光标在文本末尾）、`ai-chat-composer.test.tsx`。
- **激活哪一个面，哪一个面就必须真的在视**：中心区同一时刻只有一个面在视（对话 / 文件 / 浏览器 / 插件页签 / 插件中心 / 任务工作台 / 差异），互斥靠各激活入口维护（`ChatCenterPane.centerSurfaces` 只按布尔量判定可见性）。新建会话（侧栏、页签条 `+`、快捷键）、工作区行 `+`、点击会话线程、新建浏览器、打开文件（文件树/搜索/插件桥）以及插件的 `openCenterTab` / `selectSession`，在激活自己的面之前必须清掉其他面（`src/features/chat/center-surfaces.ts` 的 `dismissCenterSurfaces`；文件侧是 `files/store.ts` 的等价清场，先清后设 `activeFilePath`），否则页签条已经高亮到新页签、画面还停在上一个面。回归：`use-chat-sidebar.test.tsx`、`files/store.test.ts`。
- **详情页的滚动契约**：`lg` 上右信息栏 sticky 之外还要有高度上限和自己的滚动（`PluginDetailPage.tsx` 的 `RAIL`：`lg:max-h-[calc(100dvh-10.5rem)]` + `lg:overflow-y-auto`）——权限展开后信息栏可以比窗口高，只 sticky 不限高会把它压在视口里，「链接」等末尾行要把左侧 README 滚到底才看得到。左栏 README 的代码块由 `prose-plugin-readme pre`（`src/index.css`）自己横向滚动：单行超长命令在正文列内滚动，不允许画到右信息栏上。
- **插件权限必须自称归属**：插件详情页右栏的权限行标签是「权限（CCGUI权限）」（`plugins.hub.permissionsTitle`）——只写「权限」会被读成电脑系统权限，括号里的归属是必需的，不是可选修饰；中英文同步（`Permissions (CCGUI)`）。该行的 `permissionsEmpty` / `permissionsCount` 与列表项语义不变。不要与聊天输入框的引擎权限模式（`plugins.hub` 之外的 `permissions` / `permissionLabel`）混用同一处修改。
- **「链接」三项各带目标图标**：插件详情页右栏的仓库 / 发布记录 / 问题反馈在文字前各给一个 14px（`size-3.5 shrink-0`）lucide 图标——GitHub 标记（`github`）、发布标签（`tag`）、issue 圆点（`circle-dot`），三个目的地不读文字也能分开；图标 `aria-hidden`，可访问名仍只有链接文字。文字后的 `square-arrow-out-up-right` 保留：图标说明去哪儿，箭头说明会离开应用，两者不互相替代（`ExternalLink`）。回归：`PluginHub.test.tsx` 详情页用例。
- **浮动滚动浮标方向跟随滚轮**：聊天时间线的浮动控件（`ScrollControl.tsx`）只在用户滚轮后出现——向上滚显示「回到顶部」（`ArrowUp` / `chat.backToTop`，点击暂停跟随后平滑滚回顶部），向下滚显示「回到底部」（`ArrowDown` / `chat.backToBottom`，点击恢复跟随并平滑滑向尾部，落定后再硬钉一次吸收动画期间长高的内容）；仅在内容不足一屏、已在底部（距底 100px 内）或滚轮停下 1.5s 后隐藏。`scroll` / `resize` 只负责隐藏、从不主动显示，所以流式钉底不会闪出浮标；平滑滑向尾部的整个过程中自动钉底让位（`use-scroll-follow.ts` 的 `smoothPinRef`），避免中途一次流式刷新把过渡掐断；`prefers-reduced-motion` 下两侧都改为瞬时跳转。
- **可折叠分组标题的箭头尾随标签**：设置页导航（`src/components/application/settings/settings-shell.tsx`）里可折叠分组的标题行是「标签 + 右侧箭头」——箭头只占行尾，标题文字留在与静态分组标题（如「插件」）相同的左侧内边距列上，而不是被头部箭头推进条目图标列；展开只转箭头（`rotate-90`），`aria-expanded` 同步。
- **目标引擎的同步态用可点的引擎图标**：能力扩展 → Skills 行的引擎同步态是一排引擎图标按钮（`TargetEngines`，`src/features/skills/components.tsx`）：彩色=该引擎已有副本、淡化（`opacity-35 grayscale`）=无副本、右下角红点=副本丢失（orphan，点它即重新同步）；点击只切换该引擎（未纳管的本地技能会先纳管再同步），图标是行按钮的兄弟节点，不会顺便打开详情面板。每个按钮带 `aria-pressed`（synced 为 true）与 `title` / `aria-label`（「{{引擎}} 已同步 / 副本丢失 / 无副本」），不把颜色当唯一信息；未安装的引擎（后端 `available:false`，home 不存在）静默不渲染，已有副本或副本丢失的引擎必须保留，否则清理路径就消失了。你自己的本地副本（未纳管技能在引擎里的目录）禁用取消，`title` 说明「你自己的本地副本；应用不会删除它」。
- **配置态与运行时态分开表达**：能力扩展 → MCP 页把「配置已启用」（CLI 配置文件里的状态）与「运行时已连接」（某次会话实际加载的服务）拆成两个清单：运行时条目必须带来源会话与采集时间，没有会话 / 引擎不支持查询时用状态文案说明原因，不显示成「没有服务」。配置条目里，不可安全写入的来源只渲染带 `title` 原因的锁图标（`src/features/mcp/McpSection.tsx`），不渲染不可用的开关；开关只对已验证写入语义的来源开放。
- **禁用目标不能谎报**：Skills 详情里的目标复选框对只读来源（内置 / 系统 / 插件）禁用并同时给出只读原因文案（`skills.readonly.*`），不用静默过滤把只读来源「藏掉」。移除操作要分开「已删除」与「保留了你自己目录里的副本」（后端 `kept`）：后者不能报成「已移除」，否则刷新后图标还在，自相矛盾。
- **多引擎列表自带滚动，底部动作必须留在框内**：Skills 详情（`SkillDetailDialog.tsx`）的「同步到」最多 13 个引擎，整页内容（描述 / 属性 / 活动情况 / 同步到 / SKILL.md）放在同一个滚动体里，同步列表自己再限高滚动（`max-h-[13rem]`），「从所有 Agent 移除 / 更新 / 关闭」固定在框底——引擎变多不能把底部动作推出可视区。

## 4. 动作反馈

- **大型过程组有界展示**：`ProcessDisclosure` 每页最多 40 条思考/工具条目，默认展示最新页；「上一页 / 下一页 / 回到最新」保留全部历史可访问。用户翻到旧页后，新增工具不抢回最新页；对话内搜索命中隐藏条目时展开过程并定位到对应页。大组或批量入场取消 blur/height/mask 动画，不裁剪思考或工具原文。
- **性能诊断入口**：底部状态栏「性能」与设置「其他 → 性能诊断」页的「查看性能诊断」按钮打开同一个弹窗（该页已从「社区与反馈」页移出，含说明与打开按钮）。默认开启，提供「自动性能诊断」开关并持久保存选择；关闭停止前端与原生采样、清空记录和预览，重新开启从新窗口开始。关闭前提示先导出需保留的证据；保存失败保留原状态并显示错误。前端与原生各保留最近 **5 分钟、最多 60 条**，记录仍仅在内存，重启清空。默认只读预览与「复制诊断摘要」使用不超过 **12,000 UTF-8 字节**的结构化摘要（峰值、前五进程、峰值附近采样与最严重阻塞附近采样）；「导出完整诊断文件」保留当前快照的全部数据，以紧凑 JSON 保存，不拼接旧报告。桌面选择保存路径，取消不提示成功，写入失败提示重试；Web 发起下载后仅提示已发起，不假称落盘成功。按钮生成前/操作中禁用，窄屏允许换行。保留隐私、单核与整机 CPU 区别及 WebKit 候选归属说明；原生不可用仍可复制前端摘要；剪贴板拒绝显示 `role="alert"` 并保留手动选择文本。弹窗使用 `ModalShell`、标准按钮与可滚动内容区，不新增刷新入口。
- **渲染性能面板（react-scan）**：设置 → 其他 → 性能诊断页内的独立开关，**默认关闭**，手动开启后即时生效并持久化。打包（生产）版只提供重渲染高亮与次数，不含单次渲染耗时（开发版 `pnpm dev` 才有）。react-scan 必须在 React/react-dom 首次导入前接管 instrumentation，因此入口 `src/main.tsx` 只做启动编排：先装轻量 devtools hook，再按开关决定是否加载 overlay，应用体经动态导入的 `src/bootstrap.tsx` 加载；`src/lib/react-scan.ts` 只在开关开启时拉取 react-scan 本体 chunk（未开启时只多取几 KB 的 hook chunk，开关无需重启即生效）。

异步动作必须让用户看到三件事：**正在进行**、**成功**、**失败**。失败要么有对号以外的显式反馈（错误文案 / 状态标记），要么保持原样不误导。

### 4.1 刷新 / 重新加载：转圈 → 对号

参考实现：变更面板的刷新按钮（`src/features/git/ChangesPanelHeader.tsx`），公共实现：`src/components/base/action-feedback.tsx`。

规则：

1. **进行中**：动作图标转圈，动画用 `animate-refresh-spin`（`--animate-refresh-spin`，0.6s 一圈，linear infinite）。不要用 `animate-spin` 表达刷新反馈，也不要自定第二条时长。
2. **成功**：图标交叉淡出、绿色对号淡入 —— 对号色为 `text-notification-success-foreground`，停留 **900ms** 后淡回原图标。
3. **失败**：**不出现对号**，直接复位到原图标。
4. **至少转满一圈**：动作结束时若当前这圈没转完，等它转完再换对号（图标落回正方向，不会"歪着头"顶着对号）。这就是 `spin: true` 的含义。
5. **纯视觉反馈**：反馈容器 `aria-hidden`，按钮的 `aria-label` / `title` 保持动作名不变——刷新是否有新数据由界面本身说明，不需要播报。

接入方式（按动作有没有现成的 busy 状态选）：

| 场景 | API | 说明 |
|---|---|---|
| 动作返回 Promise，点击即发起 | `useActionFeedback({ spin: true })` → `start(action, isFailure?)` | `start` 会原样返回/抛出动作结果，接回调用方既有的错误链路；非抛错型动作（把失败写进 store）用 `isFailure` 报告失败 |
| 已有 store / props 的 in-flight 标志，或动作由别处触发 | `useRunningFeedback(running)` | 标志为 true 时转圈，落回 false 时给对号 |

```tsx
// 点击驱动
const refreshAction = useActionFeedback({ spin: true });
<button
  disabled={refreshAction.feedback === "running"}
  onClick={() =>
    void refreshAction.start(() => store.refresh(force), () => store.getState().error != null)
  }
>
  <ActionFeedbackIcon icon={RefreshCw} feedback={refreshAction.feedback} spin />
</button>

// 状态驱动
const feedback = useRunningFeedback(store.loading);
<ActionFeedbackIcon icon={RefreshCw} feedback={feedback} spin />
```

补充参数：图标不是 16px 时传 `iconClassName`（`size-3` / `size-3.5` / `size-[18px]`），需要忙碌态变色时传 `runningClassName`（如用量卡片的 `text-blue-500`）。

**不要这样做**：

- 自己写 `animate-spin` / 自定义时长 / 另一种成功表达（绿字、toast、换图标颜色）。
- 把**进度**当**刷新**：插件安装、文件上传这类有明确百分比的过程用 `Loader2` 进度语言，不用转圈+对号。
- **纯文本按钮套反馈**：报错态里的文字型"刷新"（`FileTreeBody`、`EditorPane`）保持文本形态，见 [§8](#8-待收敛)。
- 成功后按钮会立刻消失的场景硬凑对号（如插件"重新加载"成功后整行转为健康态）——按规则写，但不要为了看对号拖住状态更新。
- 与刷新无关的图标（更换密钥、重置、重发）借这套反馈。它们的语义是"变更/复位"，不是"重新读取"。

例外：变更面板的 **pull / push** 只用 `ActionFeedbackIcon`（不传 `spin`），即"点击 → 对号"——云朵图标转圈读起来像故障，不像进度。这类"一次性提交型动作"允许省略转圈，但成功/失败规则同上。

### 4.2 复制到剪贴板：Copy → Check

- 用 `src/hooks/use-copied.ts` 的 `useCopied(resetMs = COPY_FEEDBACK_MS)`，成功后图标换成 `Check`，**1500ms** 后复位。性能诊断需要显式处理复制失败，使用同一 `COPY_FEEDBACK_MS` 常量，成功反馈与卸载清理语义保持一致。
- 与刷新反馈的差异：复制没有别的成功信号，所以**可访问名一起改成"已复制"**（`aria-label` / `title`），刷新反馈则不改名。这是刻意的差别，不要强行统一。
- 复制按钮旁边有明文内容时（如密钥框），保留原布局尺寸与分隔符，只换图标。

## 5. 加载、空状态与错误

- 整块区域加载：`CenteredSpinner`；有内容但空：`EmptyState`（都来自 `src/components/base/empty-state.tsx`）。列表局部加载用行内文字或 `Loader2`，不要动辄整屏转圈。
- 行内错误：`role="alert"` 容器 + `text-text-error-primary` 文案 + 明确的下一步（重试 / 关闭）。
- 警告与失败要区分：可恢复的失败给重试入口，不可恢复的（未安装、平台不支持）给说明或跳转，不给假按钮。
- **远程桥刻意拒绝的命令不给假按钮**：被 `src-tauri/src/web/dispatch.rs` 明确排除的远程命令（如目录授权 `grant_root`，注释写明远端不得扩大文件系统授权范围），对应入口在 `isWeb` 下不渲染按钮、不显示“将授权…”预览，改为原因说明并只保留拒绝（`GrantCard.tsx`、`chat.grantWebUnavailable`）；桌面端保持完整动作。
- 进度类反馈（安装、更新、同步）用 `Loader2` / 文字百分比表达过程，与 [§4.1](#41-刷新--重新加载转圈--对号) 的刷新反馈互不替代。

## 6. 破坏性操作

- 不可逆操作（删除、卸载、丢弃改动、断开授权）先确认：`ConfirmDialog`（`src/components/dialogs.tsx`），危险确认按钮用 `variant="danger"`。
- 由指针发起的行内破坏性操作可以用 `ConfirmPopover`，让确认贴近光标。
- 文案写清**后果对象**（删的是哪个文件/会话/插件），不写"确定吗？"。
- **退出应用**：窗口关闭按钮一律先确认（`src/lib/close-confirm.ts` 拦截 `CloseRequested`）；macOS 的 ⌘Q / 系统退出请求在存在进行中的会话时会被 `src-tauri/src/quit_guard.rs` 取消并复用同一弹窗，只有显式确认才销毁窗口退出，空闲时正常退出、不拦截。

## 7. 刷新入口清单

全项目的"重新读取"入口都登记在这里；新增一个入口就该在这里多一行。

| 入口 | 文件 | 反馈接入 | 备注 |
|---|---|---|---|
| 变更（git）刷新 | `src/features/git/ChangesPanelHeader.tsx` | `useActionFeedback({ spin: true })` | **参考实现**；pull/push 只做 click → 对号 |
| 文件树刷新 | `src/features/files/FileTreeRow.tsx` | `useRunningFeedback(filesStore.refreshing)` | 入口在工作区根行（合成根节点），随该行悬停出现（同该行「添加到聊天」加号）；刷新可能由别处触发，故走状态驱动 |
| 插件市场索引 | `src/features/plugins/hub/PluginMarketView.tsx` | `useActionFeedback` | 图标按钮位于筛选工具条（分类 chips + 排序 + 搜索）右侧；`isFailure` 读 `marketplaceStore.error` |
| 插件重新加载 | `src/features/plugins/hub/PluginInstalledRow.tsx` | `useActionFeedback` | 成功后该行转为健康态、按钮消失 |
| CLI 版本信息 | `src/features/settings/CliHeaderActions.tsx` | `useRunningFeedback(loading \|\| updating)` | 挂载时的自动探测同样转圈 → 对号 |
| 刷新用量 | `src/components/application/agent-limits/agent-limits-card.tsx` | `useRunningFeedback(refreshing)` | 带文字标签的卡片按钮，图标区放反馈 |
| 模型目录 | `src/components/application/ai-chat/engine-model-panel.tsx` | `useActionFeedback` | — |
| 浏览器刷新 | `src/features/browser/BrowserPane.tsx` | `useActionFeedback` | webview 无加载完成事件，对号 = 指令已下发 |
| 状态栏「立即同步」 | `src/components/application/app-status-bar/app-status-bar.tsx` | `useRunningFeedback(syncing)` | 进度由 `scan://progress` 事件驱动 |
| Skills 刷新 | `src/features/skills/InstalledPane.tsx` | `useActionFeedback({ spin: true })` | 一次动作同时重读已安装列表与更新信号；失败走行内 `role="alert"` |
| MCP 刷新 | `src/features/mcp/McpSection.tsx` | `useActionFeedback({ spin: true })` | 重读配置清单与运行时分区；写入成功后也会自动重读 |
| 报错态「刷新」 | `src/features/files/FileTreeBody.tsx`、`src/features/files/EditorPane.tsx` | **不加反馈** | 纯文本恢复入口，见 §8 |
| 更换密钥 | `src/features/settings/WebAuthCard.tsx` | **不加反馈** | 语义是"轮换"不是"刷新" |
| 接力引擎列表 | `plugins/plan-execute-relay/main.js` | 异步动作期间禁用，失败行内告警 | 独立 ESM 插件的文本动作；不导入宿主私有反馈 hook。刷新仅重读可用引擎、渠道名和模型，不触发模型请求 |

## 8. 待收敛

按"出现第二次同类问题就动手"的节奏处理，处理完把条目移出本节并写进正文。

- **`prefers-reduced-motion` 下的关键帧动画**：`ActionFeedbackIcon` 的转圈、`CenteredSpinner` 与各处 `Loader2` 目前仍会转动（过渡类已有 `motion-reduce:transition-none`）。目标：关键帧动画加 `motion-reduce:animate-none`，忙碌语义改由 disabled 态 + 文案承担。
- **两个纯文本"刷新"**（`FileTreeBody` 根目录报错、`EditorPane` 文件读不到）：要么补成图标+反馈（需要先给它们合适的按钮容器），要么确认为刻意的文本形态。目前按"不加反馈"登记在 §7。
- **反馈时长常量分散**：刷新时长在 `src/components/base/action-feedback.tsx`（600 / 900ms），复制在 `src/hooks/use-copied.ts`（1500ms）。如果出现第三处，抽成统一的动效常量，并回到本文登记。

---

## 变更记录

| 版本 | 时间 | 内容 |
|---|---|---|
| v0.34 | 2026-09-23 | Skills 支持全部已接入 CLI（Claude / Codex / Kimi / Grok / PI / OMP / DeepSeek / Antigravity / Gemini / OpenCode / Qoder / Qoder CN / Hermes + 隐藏的 agents）：行内同步态从小圆点改为可点的引擎图标（三态 + 未安装引擎隐去 + 自有本地副本不可取消），详情页加「活动情况」与「同步到」图标列表并固定底部「从所有 Agent 移除」，多引擎列表限高滚动；§3 同步规则 |
| v0.33 | 2026-09-23 | 增加聊天内插件会话模式与接力首版：显式确认最新版、多轮规划、停止与恢复、退出锁；登记插件引擎列表刷新入口 |
| v0.32 | 2026-09-23 | 性能诊断页新增「渲染性能面板（react-scan）」开关：默认关闭、即时生效并持久化，打包版仅高亮与次数；入口先装 devtools hook 再动态加载 bootstrap/overlay；§4 同步 |
| v0.31 | 2026-09-23 | 性能诊断从「社区与反馈」页移出，改为设置「其他」分组下的独立页面（说明 + 「查看性能诊断」按钮），不影响状态栏入口与弹窗行为；§4 同步 |
| v0.30 | 2026-09-23 | 诊断统一五分钟/60 条；默认复制限长摘要、完整 JSON 文件导出；默认开启、持久化开关及关闭清理语义 |
| v0.29 | 2026-09-23 | 大型过程组每页 40 条及搜索定位；状态栏与社区反馈加入本地性能诊断入口，规定隐私、采样限制、复制失败提示，复制时长复用 COPY_FEEDBACK_MS |
| v0.28 | 2026-09-23 | 新增设置「能力扩展」分组的 UI 约定：Skills 的引擎同步圆点带可访问名；MCP 把配置态与运行时态拆开、只读来源用带原因的锁而不是假开关；§7 登记 Skills / MCP 刷新入口 |
| v0.27 | 2026-09-23 | 修复「新建会话/点击会话后中心面不跳转」：新建会话（侧栏、页签条 +、快捷键）、工作区行 +、点击会话线程、新建浏览器、打开文件与插件 `openCenterTab`/`selectSession` 统一先清掉其他中心面（`center-surfaces.ts`），页签高亮与画面一致；§3 补充规则 |
| v0.26 | 2026-09-23 | 设置页导航插件条目改用插件真实品牌图：`icon` → manifest 素材（`plugin_read_artwork`）→ `layout-grid` 兜底；§2.2 与 §3 同步规则 |
| v0.25 | 2026-09 | 设置页导航可折叠分组标题改为「标签 + 尾随箭头」，标题文字与静态分组标题同一左列对齐；§3 补充规则 |
| v0.24 | 2026-09 | 插件详情页右栏「权限」改称「权限（CCGUI权限）」（英文 `Permissions (CCGUI)`），避免被读成电脑系统权限；§3 补充规则 |
| v0.23 | 2026-09 | 插件详情页右栏「链接」三项各加目标图标（GitHub 标记 / 发布标签 / issue 圆点，14px、`aria-hidden`），外部跳转箭头保留；§3 补充规则 |
| v0.22 | 2026-09 | 截图大图预览补右上角 `X`，并修好空白背景点击关闭（`ModalShell` 的 `isDismissable` 从里层 `Modal` 移到 `ModalOverlay`，整个 shell 的弹窗都受益）；§3 补充规则 |
| v0.21 | 2026-09 | 官方插件徽标整块可点，跳转品牌账号 `zhukunpenglinyutong`（`title` 报出目标主页）；徽标加 `w-fit`，不再被右栏 flex 列拉伸成整行色块；§3 补充规则 |
| v0.20 | 2026-09 | 市场安装按 manifest 的 `icon` 把索引品牌图落地到插件目录（Release 三件套不含 `docs/` 素材），插件页签的素材回退在离线时也能显示品牌图；§3 补充规则 |
| v0.19 | 2026-09 | 官方插件开发者列只显示紫色「CCGUI官方插件」徽标（不再展示账号头像/用户名，详情页右栏同规则）；下拉选项改为 CCGUI官方插件 / 社区插件 |
| v0.18 | 2026-09 | 插件市场官方插件在开发者列与详情页右栏标记紫色「官方」徽标（`isOfficialPlugin`）；排序下拉改为综合排序 / 官方 / 第三方 / 下载量，官方与第三方同时收窄列表；§3 补充规则 |
| v0.17 | 2026-09 | 对话浮动滚动控件按滚轮方向切换「回到顶部 / 回到底部」箭头，点击两侧均平滑滚动（回底落定后再硬钉吸收长高内容），仅滚轮触发显示、回底或空闲 1.5s 隐藏，reduced-motion 下瞬时跳转；§3 补充规则 |
| v0.16 | 2026-09 | 聊天右侧面板插件页签改为只显示图标（`label` 转为 `title` / 可访问名，无图标回落插件素材 → 首字母瓷砖），内建文件/变更保留图标+文字；§3 补充规则 |
| v0.15 | 2026-09 | 远程 web 端目录授权卡不再渲染「允许访问」（web 桥刻意不路由 `grant_root`），改为原因说明 + 拒绝；§5 补充规则 |
| v0.14 | 2026-09 | 撤销斜杠指令 chip：输入框、已发送气泡、排队行一律按原文渲染 `/name`（删 `command-chip` / `command-token` / `command-label` / `command-chip-policy` 及其样式、fixture、i18n 文案）；保留「跳转后真的给光标」与「草稿恢复光标落文本末尾」；§3 移除 chip 规则 |
| v0.13 | 2026-09 | 插件详情页右栏「开发者」可点击跳转 GitHub 主页（仅当能解析出 GitHub 账号，否则保持纯文本）；§3 补充规则 |
| v0.11 | 2026-09 | 草稿恢复（「创建插件」预填命令）后光标落在文本末尾；§3 补充预填草稿的光标落点规则 |
| v0.10 | 2026-09 | 插件市场支持索引 `icon` / `screenshots`：列表、详情页头部与已安装行共用插件图标，缺失回落确定性首字母瓷砖；详情页效果图缺省不渲染；§3 补充素材可选规则 |
| v0.9 | 2026-09 | 跳转聊天后输入框必须真的拿到光标（`focus-composer.ts` 按时间窗重试，带 fixture 回归） |
| v0.7 | 2026-09 | 插件中心页头新增「创建插件」（开新会话并预填内置 `/ccgui-plugin-creator`）；§3 补充页头按钮「等待 / 前提不满足」两类禁用规则 |
| v0.6 | 2026-09 | 插件详情页滚动契约：右信息栏限高并独立滚动，README 长代码行在正文列内横向滚动；§3 补充规则 |
| v0.5 | 2026-09 | 插件详情页右栏新增「最近更新时间」（索引 `updatedAt`，缺失不渲染）；§3 补充时间字段规则 |
| v0.4 | 2026-09 | 插件入口图标由拼图（`puzzle`）改为宫格（`layout-grid`），侧边栏 / 插件中心页签 / 设置页兜底三处统一；§2.2 补充图标取用规则 |
| v0.3 | 2026-09 | 插件市场开发者列改用 GitHub 真实头像（失败回落首字母瓷砖）；补充§3 头像规则 |
| v0.2 | 2026-09 | 插件市场改为表格化列表（分类 chips 带计数、排序、搜索、行内单一状态）；详情页改「左正文 + 右信息栏」；补充§3 列表状态规则 |
| v0.1 | 2026-09 | 首版：设计基础、状态规范、刷新/复制动作反馈、刷新入口清单 |
