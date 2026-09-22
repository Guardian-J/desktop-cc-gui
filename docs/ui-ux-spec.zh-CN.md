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
- 图标一律取 `lucide-react/dist/esm/icons/*`（按需具名导入）；不新引图标库，也不自绘 SVG。同一入口出现在多个位置时三处共用同一个图标：插件/插件市场 = `layout-grid`（侧边栏 `sidebar-chrome.tsx`、插件中心页签 `use-chat-tabs.ts`、设置页插件分组兜底 `SettingsPage.tsx`）。

### 2.3 文案与无障碍

- 用户可见文案一律从 `src/i18n/zh.ts`、`src/i18n/en.ts` 取，两个语言文件同步新增 key，组件里不写死中文。
- 图标按钮必须同时有 `aria-label`（可访问名）和 `title`（指针悬停）。可访问名用**动作名**（"刷新"、"重新加载"），不用"点这里"。
- 需要解释性文案、快捷键或多行说明时才用 `Tooltip`（`src/components/base/tooltip/tooltip.tsx`）：它基于 react-aria，trigger 必须是 react-aria 组件或包在 `Focusable` 里的元素；触屏上不可达，所以**关键信息不能只放在 tooltip 里**。

## 3. 状态与可用性

- 可交互元素至少实现：默认 / hover / `focus-visible`（`ring-border-focus-ring`）/ active / disabled。按钮类控件的焦点环只走 `focus-visible`（不打扰鼠标用户）；输入类控件可以用 `focus:border-border-focus-ring` 表示聚焦，因为文本输入聚焦本身就是用户意图。
- disabled 必须改变光标语义（`disabled:cursor-not-allowed` 或 `disabled:cursor-default`）并降低强调（`opacity-50`~`60` 或语义 disabled token），不能只是点不动。
- **异步动作进行中不可重入**：进行中禁用按钮（或首行拦截 `if (running) return`），避免重复请求。
- **反馈不改变布局**：图标在默认态与反馈态之间切换时，外层容器尺寸固定（`ActionFeedbackIcon` 用 `iconClassName` 同时约束容器和图标），按钮不能因为换图标而抖动。
- **动效可降级**：过渡类一律带 `motion-reduce:transition-none`；关键帧动画的降级见 [§8](#8-待收敛)。
- **同一状态只表达一次**：列表行里「已安装 / 可更新」只给一个信号——市场表的右侧按钮就是该行的状态（`安装` → `更新至 vX` → `已安装`），行内不再重复挂徽标；安装中按钮原地换成进度（`plugins.installingPct`）且保持占位不變（`PluginMarketRow.tsx`）。
- **表格化列表**：插件市场用语义 `<table>` + `table-fixed`，列头是唯一的字段说明（名称 / 开发者 / 安装量 / 版本 / 操作）；整列无数据时整列不渲染（`PluginMarketView` 的 `showDownloads`），不用一列「—」占位。开发者列的头像是该账号的真实 GitHub 头像（`githubAvatarUrl`），加载中或取不到时回落到同一配色的首字母瓷砖，不出现破图。
- **时间只说数据源里有的**：插件详情页右栏的「最近更新时间」只取索引 `plugins/<id>.json` 的 `updatedAt`（上游 Release 发布时间，`indexUpdatedAt` 解析后按当前语言格式化）；条目没有该字段就不渲染这一行，不用本机安装时间顶替，也不用「—」占位。
- **详情页的滚动契约**：`lg` 上右信息栏 sticky 之外还要有高度上限和自己的滚动（`PluginDetailPage.tsx` 的 `RAIL`：`lg:max-h-[calc(100dvh-10.5rem)]` + `lg:overflow-y-auto`）——权限展开后信息栏可以比窗口高，只 sticky 不限高会把它压在视口里，「链接」等末尾行要把左侧 README 滚到底才看得到。左栏 README 的代码块由 `prose-plugin-readme pre`（`src/index.css`）自己横向滚动：单行超长命令在正文列内滚动，不允许画到右信息栏上。

## 4. 动作反馈

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

- 用 `src/hooks/use-copied.ts` 的 `useCopied(resetMs = 1500)`，成功后图标换成 `Check`，**1500ms** 后复位。
- 与刷新反馈的差异：复制没有别的成功信号，所以**可访问名一起改成"已复制"**（`aria-label` / `title`），刷新反馈则不改名。这是刻意的差别，不要强行统一。
- 复制按钮旁边有明文内容时（如密钥框），保留原布局尺寸与分隔符，只换图标。

## 5. 加载、空状态与错误

- 整块区域加载：`CenteredSpinner`；有内容但空：`EmptyState`（都来自 `src/components/base/empty-state.tsx`）。列表局部加载用行内文字或 `Loader2`，不要动辄整屏转圈。
- 行内错误：`role="alert"` 容器 + `text-text-error-primary` 文案 + 明确的下一步（重试 / 关闭）。
- 警告与失败要区分：可恢复的失败给重试入口，不可恢复的（未安装、平台不支持）给说明或跳转，不给假按钮。
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
| 文件树刷新 | `src/features/chat/ChatPanelHeader.tsx` | `useRunningFeedback(filesStore.refreshing)` | 刷新可能由别处触发，故走状态驱动 |
| 插件市场索引 | `src/features/plugins/hub/PluginMarketView.tsx` | `useActionFeedback` | 图标按钮位于筛选工具条（分类 chips + 排序 + 搜索）右侧；`isFailure` 读 `marketplaceStore.error` |
| 插件重新加载 | `src/features/plugins/hub/PluginInstalledRow.tsx` | `useActionFeedback` | 成功后该行转为健康态、按钮消失 |
| CLI 版本信息 | `src/features/settings/CliHeaderActions.tsx` | `useRunningFeedback(loading \|\| updating)` | 挂载时的自动探测同样转圈 → 对号 |
| 刷新用量 | `src/components/application/agent-limits/agent-limits-card.tsx` | `useRunningFeedback(refreshing)` | 带文字标签的卡片按钮，图标区放反馈 |
| 模型目录 | `src/components/application/ai-chat/engine-model-panel.tsx` | `useActionFeedback` | — |
| 浏览器刷新 | `src/features/browser/BrowserPane.tsx` | `useActionFeedback` | webview 无加载完成事件，对号 = 指令已下发 |
| 状态栏「立即同步」 | `src/components/application/app-status-bar/app-status-bar.tsx` | `useRunningFeedback(syncing)` | 进度由 `scan://progress` 事件驱动 |
| 报错态「刷新」 | `src/features/files/FileTreeBody.tsx`、`src/features/files/EditorPane.tsx` | **不加反馈** | 纯文本恢复入口，见 §8 |
| 更换密钥 | `src/features/settings/WebAuthCard.tsx` | **不加反馈** | 语义是"轮换"不是"刷新" |

## 8. 待收敛

按"出现第二次同类问题就动手"的节奏处理，处理完把条目移出本节并写进正文。

- **`prefers-reduced-motion` 下的关键帧动画**：`ActionFeedbackIcon` 的转圈、`CenteredSpinner` 与各处 `Loader2` 目前仍会转动（过渡类已有 `motion-reduce:transition-none`）。目标：关键帧动画加 `motion-reduce:animate-none`，忙碌语义改由 disabled 态 + 文案承担。
- **两个纯文本"刷新"**（`FileTreeBody` 根目录报错、`EditorPane` 文件读不到）：要么补成图标+反馈（需要先给它们合适的按钮容器），要么确认为刻意的文本形态。目前按"不加反馈"登记在 §7。
- **反馈时长常量分散**：刷新时长在 `src/components/base/action-feedback.tsx`（600 / 900ms），复制在 `src/hooks/use-copied.ts`（1500ms）。如果出现第三处，抽成统一的动效常量，并回到本文登记。

---

## 变更记录

| 版本 | 时间 | 内容 |
|---|---|---|
| v0.6 | 2026-09 | 插件详情页滚动契约：右信息栏限高并独立滚动，README 长代码行在正文列内横向滚动；§3 补充规则 |
| v0.5 | 2026-09 | 插件详情页右栏新增「最近更新时间」（索引 `updatedAt`，缺失不渲染）；§3 补充时间字段规则 |
| v0.4 | 2026-09 | 插件入口图标由拼图（`puzzle`）改为宫格（`layout-grid`），侧边栏 / 插件中心页签 / 设置页兜底三处统一；§2.2 补充图标取用规则 |
| v0.3 | 2026-09 | 插件市场开发者列改用 GitHub 真实头像（失败回落首字母瓷砖）；补充§3 头像规则 |
| v0.2 | 2026-09 | 插件市场改为表格化列表（分类 chips 带计数、排序、搜索、行内单一状态）；详情页改「左正文 + 右信息栏」；补充§3 列表状态规则 |
| v0.1 | 2026-09 | 首版：设计基础、状态规范、刷新/复制动作反馈、刷新入口清单 |
