//! Skills hub 后端：从参考项目 desktop-cc-gui 的 Rust 移植 `skills_hub/` 迁移而来
//! （MIT，Copyright (c) 2026 Thomas Ricouard / zhukunpenglinyutong（朱昆鹏）），
//! 上游可溯源到 TokenTracker 的 `skills-manager.js` / `skill-usage.js`（MIT）。
//!
//! 与参考实现的差异（均为适配本仓库）：
//! 1. SSOT 根目录为本应用数据目录下的 `skills-hub/`（`paths::app_home()`），
//!    可用 env `CCGUI_SKILLS_HUB_HOME` 覆盖（测试注入点）。参考实现用
//!    `~/.ccgui/skills`，与本应用的可写存储隔离，不共享注册表。
//! 2. 目标引擎首期仅 Claude Code / Codex；引擎目录解析走 `engine::engine_home`
//!    与 `engine::codex_home`，尊重 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 与设置页
//!    的 Codex 目录覆盖。只出现在 CLI 目录、不属于本应用托管的目标是只读来源
//!    （Codex `.system`、插件缓存、随包分发的内置 skill）。
//! 3. skill_usage 的统计范围固定为 Claude Code 会话转录
//!    （`<claude home>/projects/**/*.jsonl`），响应带 scope 字段说明；Codex
//!    没有可可靠读取的 Skill 调用记录，不可用时显示"暂无可用数据"。
//! 4. 删除/卸载入口对只读来源（内置、系统、插件）一律拒绝，保护
//!    `creator_skill.rs` 安装的随包 skill。

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::fsutil::*;
// ===== 常量（与上游 skills-manager.js / skill-usage.js 对齐） =====

pub(super) const FETCH_TIMEOUT: Duration = Duration::from_secs(20); // upstream FETCH_TIMEOUT_MS
pub(super) const DISCOVER_CONCURRENCY: usize = 4; // upstream DISCOVER_CONCURRENCY
pub(super) const DISCOVER_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 小时
pub(super) const UPDATE_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 小时
pub(super) const UPDATE_CHECK_CONCURRENCY: usize = 2; // upstream UPDATE_CHECK_CONCURRENCY
pub(super) const POPULAR_CACHE_TTL_MS: i64 = 6 * 60 * 60 * 1000; // 6 小时
pub(super) const TRASH_TTL_MS: i64 = 5 * 60 * 1000; // 5 分钟
pub(super) const ACTIVITY_MAX: usize = 500; // upstream ACTIVITY_MAX
pub(super) const ACTIVITY_TRIM_BYTES: u64 = 256 * 1024; // 超过则截尾保留最后 ACTIVITY_MAX 行
pub(super) const USAGE_CACHE_TTL_MS: i64 = 10 * 60 * 1000; // 10 分钟
pub(super) const MAX_LOCAL_SKILL_SCAN_DEPTH: usize = 3; // upstream MAX_LOCAL_SKILL_SCAN_DEPTH
pub(super) const DISCOVER_MAX_SKILLS_PER_REPO: usize = 200; // upstream discover 单 repo 截断 200
pub(super) const POPULAR_SEED_QUERIES: [&str; 12] = [
    "agent", "code", "test", "review", "git", "web", "design", "data", "docs", "python", "api",
    "deploy",
];
pub(super) const HASH_IGNORE: [&str; 4] = [".git", ".DS_Store", "Thumbs.db", ".gitignore"];
/// 统计口径：Claude Code 的会话转录（含 Skill 工具调用）。
pub(super) const USAGE_SCOPE_CLAUDE_TRANSCRIPTS: &str = "claude_code_transcripts";

// ===== 错误类型：RateLimit 需要在 allSettled 语义里被单独识别并上抛 =====

#[derive(Debug)]
pub(super) enum SkillError {
    /// GitHub / skills.sh 限流（HTTP 429|403），文案必须与 upstream 一致。
    RateLimited(String),
    /// 带错误码的失败：前端据此给出对应恢复路径。
    Coded(&'static str, String),
    Other(String),
}

impl SkillError {
    pub(super) fn other(message: impl Into<String>) -> Self {
        Self::Other(message.into())
    }
    pub(super) fn coded(code: &'static str, message: impl Into<String>) -> Self {
        Self::Coded(code, message.into())
    }
    pub(super) fn is_rate_limited(&self) -> bool {
        matches!(self, Self::RateLimited(_))
    }
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited(m) | Self::Coded(_, m) | Self::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for SkillError {}

impl From<std::io::Error> for SkillError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            std::io::ErrorKind::PermissionDenied => "permission",
            std::io::ErrorKind::AlreadyExists => "conflict",
            _ => "internal",
        };
        Self::coded(code, error.to_string())
    }
}

pub(super) type SkillResult<T> = Result<T, SkillError>;

// ===== 路径解析：SSOT 根目录（可注入）与本应用托管的引擎目标 =====

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// SSOT 根目录：env `CCGUI_SKILLS_HUB_HOME` 覆盖（测试注入点），
/// 缺省 `~/.ccgui-next/skills-hub`（本应用自己的数据目录，与参考项目隔离）。
pub(super) fn skills_root() -> PathBuf {
    if let Some(override_dir) = std::env::var_os("CCGUI_SKILLS_HUB_HOME") {
        if !override_dir.is_empty() {
            return PathBuf::from(override_dir);
        }
    }
    crate::paths::app_home().join("skills-hub")
}

pub(super) fn registry_path() -> PathBuf {
    skills_root().join("registry.json")
}
pub(super) fn ssot_dir() -> PathBuf {
    skills_root().join("managed")
}
pub(super) fn trash_dir() -> PathBuf {
    skills_root().join(".trash")
}
pub(super) fn tmp_dir() -> PathBuf {
    skills_root().join("tmp")
}
pub(super) fn discover_cache_path() -> PathBuf {
    skills_root().join("discover-cache.json")
}
pub(super) fn updates_cache_path() -> PathBuf {
    skills_root().join("updates-cache.json")
}
pub(super) fn popular_cache_path() -> PathBuf {
    skills_root().join("popular-cache.json")
}
pub(super) fn activity_path() -> PathBuf {
    skills_root().join("activity.jsonl")
}
pub(super) fn usage_cache_path() -> PathBuf {
    skills_root().join("usage-cache.json")
}

pub(super) fn is_dir(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

/// 引擎 skills 根（Claude / Codex / 跨 agent 的 `~/.agents`）。
/// Claude 尊重 `CLAUDE_CONFIG_DIR`，Codex 尊重 `CODEX_HOME` 与设置页覆盖
/// （见 `engine::codex_home`）——与聊天 `/` 选择器的目录解析保持同一套规则。
fn claude_skills_dir() -> PathBuf {
    crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("skills")
}
fn codex_skills_dir() -> PathBuf {
    crate::engine::codex_home().join("skills")
}
fn agents_skills_dir() -> PathBuf {
    crate::engine::engine_home(None, ".agents").join("skills")
}

/// 本应用托管的同步目标：Claude Code 与 Codex 各一份受管副本；`agents`
/// 是跨 agent 的共享 skills 根，沿用参考实现的隐藏目标（不进 UI 引擎列表，
/// 但参与扫描/分类/同步，保证"移除某个引擎副本"的语义完整）。
pub(super) enum TargetKind {
    Claude,
    Codex,
    Agents,
}

pub(super) struct Target {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) visible: bool, // visible=false 不进 targetList
    pub(super) kind: TargetKind,
}

/// 首期只暴露 Claude Code / Codex；顺序与 UI 引擎页签一致。
pub(super) static TARGETS: [Target; 3] = [
    Target {
        id: "claude",
        label: "Claude",
        visible: true,
        kind: TargetKind::Claude,
    },
    Target {
        id: "codex",
        label: "Codex",
        visible: true,
        kind: TargetKind::Codex,
    },
    Target {
        id: "agents",
        label: "Agents",
        visible: false,
        kind: TargetKind::Agents,
    },
];

pub(super) fn target_by_id(id: &str) -> Option<&'static Target> {
    TARGETS.iter().find(|target| target.id == id)
}

/// 目标目录在调用时按 env/home 动态解析（测试可经 HOME 注入）。
pub(super) fn target_dirs(target: &Target) -> Vec<PathBuf> {
    match target.kind {
        TargetKind::Claude => vec![claude_skills_dir()],
        TargetKind::Codex => vec![codex_skills_dir()],
        TargetKind::Agents => vec![agents_skills_dir()],
    }
}

/// 对应 upstream targetPrimaryDir（首期都是单目录，保留多目录签名）。
pub(super) fn target_primary_dir(target: &Target) -> PathBuf {
    target_dirs(target).into_iter().next().unwrap_or_default()
}

/// 对应 upstream targetList：仅 visible target。
pub(super) fn target_list() -> Vec<Value> {
    TARGETS
        .iter()
        .filter(|target| target.visible)
        .map(|t| {
            json!({
                "id": t.id,
                "label": t.label,
                "path": target_primary_dir(t).to_string_lossy(),
                "readonly": false,
            })
        })
        .collect()
}

// ===== 只读来源：本应用不纳管、只扫描展示的 skill 目录 =====

/// 只读来源的种类。UI 用它区分"内置 / 系统 / 插件提供"，并禁用所有删除入口。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ReadonlyKind {
    /// 随包分发的内置 skill（creator_skill.rs 安装到各引擎 skills 根）。
    Builtin,
    /// Codex 自带的 `.system` skills。
    System,
    /// Codex 插件缓存里随插件附带的 skills。
    Plugin,
}

impl ReadonlyKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::System => "system",
            Self::Plugin => "plugin",
        }
    }
}

pub(super) struct ReadonlySource {
    pub(super) kind: ReadonlyKind,
    pub(super) dir: PathBuf,
}

/// 内置 skill 的目录名（= `creator_skill::SKILL_ID`）。这些目录即使出现在
/// Claude/Codex 的托管目标根里也按"内置"处理：只读、禁止删除/导入。
pub(super) fn bundled_skill_names() -> HashSet<String> {
    [crate::creator_skill::SKILL_ID.to_string()]
        .into_iter()
        .collect()
}

/// 当前存在的只读来源目录。Codex 的 `.system` 与插件缓存目录在未安装时
/// 不存在，函数只返回真实存在的目录。
pub(super) fn readonly_sources() -> Vec<ReadonlySource> {
    let mut out: Vec<ReadonlySource> = Vec::new();
    let codex_home = crate::engine::codex_home();
    let system_dir = codex_home.join("skills").join(".system");
    if is_dir(&system_dir) {
        out.push(ReadonlySource {
            kind: ReadonlyKind::System,
            dir: system_dir,
        });
    }
    for (dir, _) in crate::slash_commands::codex_plugin_skills_dirs(&codex_home) {
        out.push(ReadonlySource {
            kind: ReadonlyKind::Plugin,
            dir,
        });
    }
    out
}

/// 一个 skill 目录的来源种类（用于 UI 徽标与写操作门禁）。
pub(super) fn readonly_kind_for_dir(directory: &str) -> Option<ReadonlyKind> {
    let leaf = install_name_from_directory(directory)?;
    if bundled_skill_names().contains(&leaf) {
        // 内置 skill 的名字是全局保留的：同名目录一律按内置保护，避免用户
        // 误建同名目录后被通用删除逻辑清掉、也避免被同步覆盖。
        return Some(ReadonlyKind::Builtin);
    }
    for source in readonly_sources() {
        if super::scan::find_skill_marker(&source.dir.join(&leaf)).is_some() {
            return Some(source.kind);
        }
    }
    None
}

/// 目录是否是"内置 skill 名"（不受位置影响，用于 import/delete 预检）。
pub(super) fn is_bundled_skill_name(directory: &str) -> bool {
    install_name_from_directory(directory)
        .map(|leaf| bundled_skill_names().contains(&leaf))
        .unwrap_or(false)
}
