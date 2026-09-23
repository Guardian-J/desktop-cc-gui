//! MCP 来源注册表 + 其余 CLI 的声明式配置读写。
//!
//! Claude / Codex 的读写在 `config.rs`（两者的作用域规则特殊）；这里用一张
//! 声明表覆盖其他引擎：文件位置、服务器表键名、字段名与启停语义都在表里，
//! 读取只解析文件、绝不启动 CLI。
//!
//! 读取（read）与写入（write）分文件；写入只对在真实 CLI 上验证过语义的来源开放（grok：`enabled` +
//! `disabled_mcp_servers`；opencode：`enabled`），其余来源返回 `writable=false`
//! 与原因码，由 UI 本地化展示，不提供会写坏别人配置的假开关。

use super::{McpConfigSection, McpSourceError, McpSourceInfo};
use std::path::PathBuf;

mod read;
mod write;

pub(super) use write::write_enabled;
use read::{read_dsh_profile, read_json_source, read_toml_source};

#[cfg(test)]
mod tests;

// ===== 来源注册表 =====

pub(super) const SOURCE_CLAUDE_USER: &str = "claude_user";
pub(super) const SOURCE_CLAUDE_LOCAL: &str = "claude_local";
pub(super) const SOURCE_CLAUDE_PROJECT: &str = "claude_project";
pub(super) const SOURCE_CODEX_USER: &str = "codex_user";
pub(super) const SOURCE_CODEX_PROJECT: &str = "codex_project";

/// 只读原因码：UI 按 `mcp.readonlyReason.<code>` 本地化。
pub(super) const REASON_UNVERIFIED_WRITE: &str = "unverified_write";
pub(super) const REASON_SHARED_PROJECT_FILE: &str = "shared_project_file";
pub(super) const REASON_GROK_PROJECT: &str = "grok_project_toggle";
pub(super) const REASON_DSH_PLUGIN: &str = "dsh_plugin";
pub(super) const REASON_JSONC_READONLY: &str = "jsonc_readonly";

/// 一个配置来源：条目标识前缀、引擎、作用域与写入能力。
pub(super) struct SourceSpec {
    pub id: &'static str,
    pub engine: &'static str,
    pub scope: &'static str,
    pub writable: bool,
    /// 旧来源的说明文案（保留原样，不翻译）。
    pub readonly_reason: Option<&'static str>,
    /// 新来源的原因码（UI 本地化）。
    pub readonly_reason_code: Option<&'static str>,
}

/// 服务器表里的字段名（不同 CLI 的写法差异都收在这里）。
struct Fields {
    command: &'static str,
    args: &'static str,
    env: &'static str,
    url: &'static str,
    headers: &'static str,
    transport: &'static str,
}

/// Claude 形状：`command` 字符串 + `args` 数组。
const CLAUDE_FIELDS: Fields = Fields {
    command: "command",
    args: "args",
    env: "env",
    url: "url",
    headers: "headers",
    transport: "type",
};
/// OpenCode：`command` 是数组（首个元素是命令），环境变量键叫 `environment`。
const OPENCODE_FIELDS: Fields = Fields {
    command: "command",
    args: "args",
    env: "environment",
    url: "url",
    headers: "headers",
    transport: "type",
};

/// 原生启停语义：`enabled` 缺省 true；`disabled` 缺省 false。
#[derive(Clone, Copy, PartialEq, Eq)]
enum Toggle {
    Enabled,
    Disabled,
}

struct Source {
    id: &'static str,
    engine: &'static str,
    scope: &'static str,
    /// json | toml | yaml
    format: &'static str,
    servers_key: &'static str,
    fields: Fields,
    /// `command` 是数组（opencode local 形式）。
    command_is_array: bool,
    toggle: Option<Toggle>,
    writable: bool,
    readonly_reason_code: &'static str,
}

macro_rules! json_source {
    ($id:literal, $engine:literal, $scope:literal, $toggle:expr, $array:expr, $writable:expr, $reason:expr) => {
        Source {
            id: $id,
            engine: $engine,
            scope: $scope,
            format: "json",
            servers_key: "mcpServers",
            fields: CLAUDE_FIELDS,
            command_is_array: $array,
            toggle: $toggle,
            writable: $writable,
            readonly_reason_code: $reason,
        }
    };
}

/// 新来源表。`paths()` 负责把每个来源解析成候选文件（第一个存在的生效）。
const SOURCES: &[Source] = &[
    json_source!(
        "kimi_user",
        "kimi",
        "user",
        Some(Toggle::Enabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "kimi_local",
        "kimi",
        "project",
        Some(Toggle::Enabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "kimi_project",
        "kimi",
        "project",
        Some(Toggle::Enabled),
        false,
        false,
        REASON_SHARED_PROJECT_FILE
    ),
    Source {
        id: "grok_user",
        engine: "grok",
        scope: "user",
        format: "toml",
        servers_key: "mcp_servers",
        fields: CLAUDE_FIELDS,
        command_is_array: false,
        toggle: Some(Toggle::Enabled),
        writable: true,
        readonly_reason_code: "",
    },
    Source {
        id: "grok_project",
        engine: "grok",
        scope: "project",
        format: "toml",
        servers_key: "mcp_servers",
        fields: CLAUDE_FIELDS,
        command_is_array: false,
        toggle: Some(Toggle::Enabled),
        writable: false,
        readonly_reason_code: REASON_GROK_PROJECT,
    },
    json_source!(
        "omp_user",
        "omp",
        "user",
        Some(Toggle::Enabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "omp_project",
        "omp",
        "project",
        Some(Toggle::Enabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    Source {
        id: "opencode_user",
        engine: "opencode",
        scope: "user",
        format: "json",
        servers_key: "mcp",
        fields: OPENCODE_FIELDS,
        command_is_array: true,
        toggle: Some(Toggle::Enabled),
        writable: true,
        readonly_reason_code: "",
    },
    Source {
        id: "opencode_project",
        engine: "opencode",
        scope: "project",
        format: "json",
        servers_key: "mcp",
        fields: OPENCODE_FIELDS,
        command_is_array: true,
        toggle: Some(Toggle::Enabled),
        writable: true,
        readonly_reason_code: "",
    },
    json_source!(
        "agy_user",
        "agy",
        "user",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "agy_project",
        "agy",
        "project",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "qoder_user",
        "qoder",
        "user",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "qoder_local",
        "qoder",
        "project",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "qoder_project",
        "qoder",
        "project",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_SHARED_PROJECT_FILE
    ),
    json_source!(
        "qoder_cn_user",
        "qoder-cn",
        "user",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "qoder_cn_local",
        "qoder-cn",
        "project",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_UNVERIFIED_WRITE
    ),
    json_source!(
        "qoder_cn_project",
        "qoder-cn",
        "project",
        Some(Toggle::Disabled),
        false,
        false,
        REASON_SHARED_PROJECT_FILE
    ),
    Source {
        id: "dsh_profile",
        engine: "dsh",
        scope: "user",
        format: "yaml",
        servers_key: "",
        fields: CLAUDE_FIELDS,
        command_is_array: false,
        toggle: Some(Toggle::Disabled),
        writable: false,
        readonly_reason_code: REASON_DSH_PLUGIN,
    },
];

/// dsh 里一个 MCP 服务 = 一个 `dsh-mcp-client` 插件实例。
const DSH_MCP_PLUGIN: &str = "@deepseek-ai/dsh-mcp-client";

/// 全部来源（Claude / Codex 的特殊来源 + 声明表）。
pub(super) fn source_spec(id: &str) -> Option<SourceSpec> {
    match id {
        SOURCE_CLAUDE_USER => Some(SourceSpec {
            id: SOURCE_CLAUDE_USER,
            engine: "claude",
            scope: "user",
            writable: false,
            readonly_reason: Some(
                "Claude Code 未在该来源提供可验证的原生停用开关，这里只读展示；请在 Claude Code 内管理",
            ),
            readonly_reason_code: None,
        }),
        SOURCE_CLAUDE_LOCAL => Some(SourceSpec {
            id: SOURCE_CLAUDE_LOCAL,
            engine: "claude",
            scope: "project",
            writable: false,
            readonly_reason: Some("local 作用域存在用户配置里，没有按服务停用的原生开关，这里只读展示"),
            readonly_reason_code: None,
        }),
        SOURCE_CLAUDE_PROJECT => Some(SourceSpec {
            id: SOURCE_CLAUDE_PROJECT,
            engine: "claude",
            scope: "project",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        SOURCE_CODEX_USER => Some(SourceSpec {
            id: SOURCE_CODEX_USER,
            engine: "codex",
            scope: "user",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        SOURCE_CODEX_PROJECT => Some(SourceSpec {
            id: SOURCE_CODEX_PROJECT,
            engine: "codex",
            scope: "project",
            writable: true,
            readonly_reason: None,
            readonly_reason_code: None,
        }),
        _ => SOURCES.iter().find(|source| source.id == id).map(|source| {
            SourceSpec {
                id: source.id,
                engine: source.engine,
                scope: source.scope,
                writable: source.writable,
                readonly_reason: None,
                readonly_reason_code: if source.readonly_reason_code.is_empty() {
                    None
                } else {
                    Some(source.readonly_reason_code)
                },
            }
        }),
    }
}

pub(super) fn engine_of_source(id: &str) -> Option<&'static str> {
    source_spec(id).map(|spec| spec.engine)
}

/// 某个引擎实际会被读取的来源文件（含尚未创建的首选路径），用于空状态
/// 解释「本页看的是哪些文件」。
pub(super) fn engine_source_infos(engine: &str, workspace: Option<&str>) -> Vec<McpSourceInfo> {
    SOURCES
        .iter()
        .filter(|source| source.engine == engine)
        .filter_map(|source| {
            let candidates = candidate_paths(source.id, workspace);
            // 展示实际生效的候选（第一个存在的），否则第一个预期位置。
            let path = first_existing(candidates.clone())
                .or_else(|| candidates.into_iter().next())?;
            Some(McpSourceInfo {
                source: source.id.to_string(),
                exists: path.is_file(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

/// 该引擎是否提供 MCP 配置：native（原生）/ plugin（插件提供）/ none。
pub(super) fn engine_support(id: &str) -> &'static str {
    match id {
        // PI CLI 明确不内置 MCP（上游文档：No MCP），本项目不伪造来源。
        "pi" => "none",
        "dsh" => "plugin",
        _ => "native",
    }
}

// ===== 路径解析 =====

fn kimi_home() -> PathBuf {
    crate::engine::engine_home(Some("KIMI_CODE_HOME"), ".kimi-code")
}
fn grok_home() -> PathBuf {
    crate::engine::engine_home(Some("GROK_HOME"), ".grok")
}
/// OMP 的 agent 目录（用户级 mcp.json 就在其下）。
fn omp_agent_dir() -> PathBuf {
    for key in ["OMP_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] {
        if let Some(dir) = std::env::var_os(key).filter(|value| !value.is_empty()) {
            return PathBuf::from(dir);
        }
    }
    crate::engine::engine_home(None, ".omp").join("agent")
}
fn opencode_home() -> PathBuf {
    crate::engine::engine_home(Some("XDG_CONFIG_HOME"), ".config").join("opencode")
}
fn antigravity_home() -> PathBuf {
    crate::engine::engine_home(Some("ANTIGRAVITY_HOME"), ".gemini/antigravity-cli")
}
fn qoder_home(cn: bool) -> PathBuf {
    crate::engine::engine_home(None, if cn { ".qoder-cn" } else { ".qoder" })
}
fn dsh_home() -> PathBuf {
    crate::engine::engine_home(Some("DSH_HOME"), ".dsh")
}

fn join_all(home: PathBuf, names: &[&str]) -> Vec<PathBuf> {
    names.iter().map(|name| home.join(name)).collect()
}

/// 一个来源的候选文件（按优先级；读取时取第一个存在的）。
fn candidate_paths(id: &str, workspace: Option<&str>) -> Vec<PathBuf> {
    let workspace_path = workspace.map(PathBuf::from);
    match id {
        "kimi_user" => vec![kimi_home().join("mcp.json")],
        "kimi_local" => workspace_path
            .map(|path| vec![path.join(".kimi-code").join("mcp.json")])
            .unwrap_or_default(),
        "kimi_project" | "qoder_project" | "qoder_cn_project" => workspace_path
            .map(|path| vec![path.join(".mcp.json")])
            .unwrap_or_default(),
        "grok_user" => vec![grok_home().join("config.toml")],
        "grok_project" => workspace_path
            .map(|path| vec![path.join(".grok").join("config.toml")])
            .unwrap_or_default(),
        "omp_user" => vec![omp_agent_dir().join("mcp.json")],
        "omp_project" => workspace_path
            .map(|path| vec![path.join(".omp").join("mcp.json")])
            .unwrap_or_default(),
        "opencode_user" => join_all(opencode_home(), &["opencode.json", "opencode.jsonc"]),
        "opencode_project" => workspace_path
            .map(|path| {
                let mut paths = join_all(path.clone(), &["opencode.json", "opencode.jsonc"]);
                paths.extend(join_all(path.join(".opencode"), &["opencode.json", "opencode.jsonc"]));
                paths
            })
            .unwrap_or_default(),
        "agy_user" => {
            let mut paths = vec![crate::engine::engine_home(None, ".gemini")
                .join("config")
                .join("mcp_config.json")];
            paths.push(antigravity_home().join("config").join("mcp_config.json"));
            paths
        }
        "agy_project" => workspace_path
            .map(|path| vec![path.join(".agents").join("mcp_config.json")])
            .unwrap_or_default(),
        "qoder_user" => vec![qoder_home(false).join("settings.json")],
        "qoder_local" => workspace_path
            .map(|path| vec![path.join(".qoder").join("settings.local.json")])
            .unwrap_or_default(),
        "qoder_cn_user" => vec![qoder_home(true).join("settings.json")],
        "qoder_cn_local" => workspace_path
            .map(|path| vec![path.join(".qoder-cn").join("settings.local.json")])
            .unwrap_or_default(),
        "dsh_profile" => join_all(
            dsh_home().join("profiles").join("web"),
            &["cordis.yml", "cordis.patch.yml"],
        ),
        _ => Vec::new(),
    }
}

fn first_existing(paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|path| path.is_file())
}

// ===== 读取 =====

pub(super) fn append_entries(section: &mut McpConfigSection, workspace: Option<&str>) {
    for source in SOURCES {
        let Some(path) = first_existing(candidate_paths(source.id, workspace)) else {
            continue;
        };
        let result = match source.format {
            "toml" => read_toml_source(source, &path),
            "yaml" => read_dsh_profile(&path),
            _ => read_json_source(source, &path),
        };
        match result {
            Ok(mut entries) => section.entries.append(&mut entries),
            Err(error) => section.errors.push(McpSourceError {
                source: source.id.to_string(),
                path: path.to_string_lossy().into_owned(),
                message: error.message,
            }),
        }
    }
}

