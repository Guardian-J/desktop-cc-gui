//! 服务器表读取：JSON / JSONC / TOML 与 dsh 的 profile YAML。
//!
//! 解析一律只读文件；条目字段按 `Source.fields` 映射，启停按 `Source.toggle`
//! 解读（字符串 "false"/"0" 也按停用处理）。

use super::{grok_home, source_spec, Source, Toggle, DSH_MCP_PLUGIN, REASON_JSONC_READONLY};
use crate::mcp::config::{file_hash, object_keys, read_text, redact_url};
use crate::mcp::{parse_json, McpConfigEntry, McpError};
use serde_json::{Map, Value};
use std::path::Path;
use toml_edit::DocumentMut;

/// JSONC（opencode 的 `opencode.jsonc`）允许注释与尾逗号；写入会丢注释，
/// 所以这类文件只读。解析先做字符串感知的注释/尾逗号清理，再走 serde_json。
pub(super) fn parse_jsonc(text: &str, path: &str) -> Result<Value, McpError> {
    let stripped = strip_jsonc(text)
        .ok_or_else(|| McpError::format(format!("{path}: unterminated string in JSONC")))?;
    serde_json::from_str::<Value>(&stripped)
        .map_err(|error| McpError::format(format!("{path}: invalid JSON: {error}")))
}

pub(super) fn strip_jsonc(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => {
                in_string = true;
                out.push(ch);
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            _ => out.push(ch),
        }
    }
    if in_string {
        return None;
    }
    // 尾逗号：在对象/数组闭合前删掉逗号（字符串外已经安全）。
    let mut trimmed = String::with_capacity(out.len());
    let mut pending_comma: Option<usize> = None;
    for ch in out.chars() {
        match ch {
            ',' => {
                pending_comma = Some(trimmed.len());
                trimmed.push(ch);
            }
            ']' | '}' => {
                if let Some(index) = pending_comma.take() {
                    trimmed.remove(index);
                }
                trimmed.push(ch);
            }
            ch if ch.is_whitespace() => trimmed.push(ch),
            ch => {
                pending_comma = None;
                trimmed.push(ch);
            }
        }
    }
    Some(trimmed)
}

pub(super) fn read_json_source(source: &Source, path: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let is_jsonc = is_jsonc(path);
    let root = if is_jsonc {
        parse_jsonc(&raw, &path.to_string_lossy())?
    } else {
        parse_json(&raw, &path.to_string_lossy())?
    };
    let mut entries = Vec::new();
    let Some(servers) = root.get(source.servers_key).and_then(Value::as_object) else {
        return Ok(entries);
    };
    for (name, raw_spec) in servers {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(spec_object) = raw_spec.as_object() else {
            continue;
        };
        entries.push(build_entry(source, name, path, &version, spec_object, is_jsonc));
    }
    Ok(entries)
}

pub(super) fn is_jsonc(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.to_string_lossy().eq_ignore_ascii_case("jsonc"))
        .unwrap_or(false)
}

pub(super) fn build_entry(
    source: &Source,
    name: &str,
    path: &Path,
    version: &str,
    spec_object: &Map<String, Value>,
    is_jsonc: bool,
) -> McpConfigEntry {
    let spec = source_spec(source.id).expect("registered source");
    // JSONC 写入会丢注释：按文件降级为只读，不按来源降级。
    let writable = spec.writable && !is_jsonc;
    let readonly_reason_code = if is_jsonc {
        Some(REASON_JSONC_READONLY.to_string())
    } else {
        spec.readonly_reason_code.map(str::to_string)
    };
    let (command, args_count) = command_and_args(source, spec_object);
    let url = spec_object
        .get(source.fields.url)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(redact_url);
    let transport = spec_object
        .get(source.fields.transport)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let env_keys = object_keys(spec_object.get(source.fields.env));
    let header_keys = object_keys(spec_object.get(source.fields.headers));
    McpConfigEntry {
        id: format!("{}:{name}", source.id),
        engine: source.engine.to_string(),
        name: name.to_string(),
        source: source.id.to_string(),
        scope: source.scope.to_string(),
        path: path.to_string_lossy().into_owned(),
        format: source.format.to_string(),
        enabled: entry_enabled(source, spec_object),
        transport,
        command,
        args_count,
        url,
        env_keys,
        header_keys,
        writable,
        readonly_reason: spec.readonly_reason.map(str::to_string),
        readonly_reason_code,
        version: version.to_string(),
    }
}

fn command_and_args(source: &Source, spec_object: &Map<String, Value>) -> (Option<String>, usize) {
    let args_field = spec_object
        .get(source.fields.args)
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    match spec_object.get(source.fields.command) {
        // opencode 的 local server：`command: ["npx","-y","pkg"]`。
        Some(Value::Array(items)) if source.command_is_array => {
            let command = items
                .first()
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            (command, items.len().saturating_sub(1) + args_field)
        }
        Some(Value::String(text)) => {
            let command = text.trim();
            let command = (!command.is_empty()).then(|| command.to_string());
            (command, args_field)
        }
        _ => (None, args_field),
    }
}

/// 启停字段：`enabled`（缺省 true）/ `disabled`（缺省 false）；字符串
/// `"false"` / `"0"` 也按停用处理（OMP 的宽容解析）。
fn bool_field(object: &Map<String, Value>, key: &str) -> Option<bool> {
    match object.get(key) {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
            "false" | "0" => Some(false),
            "true" | "1" => Some(true),
            _ => None,
        },
        _ => None,
    }
}

fn entry_enabled(source: &Source, spec_object: &Map<String, Value>) -> bool {
    match source.toggle {
        Some(Toggle::Enabled) => bool_field(spec_object, "enabled").unwrap_or(true),
        Some(Toggle::Disabled) => !bool_field(spec_object, "disabled").unwrap_or(false),
        None => true,
    }
}

/// Grok：`[mcp_servers.<name>]`；用户级的 `disabled_mcp_servers` 列表按名称
/// 停用（对项目级条目同样生效，所以项目来源也要读用户列表）。
pub(super) fn read_toml_source(source: &Source, path: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let document = raw
        .parse::<DocumentMut>()
        .map_err(|error| McpError::format(format!("{}: invalid TOML: {error}", path.display())))?;
    let mut disabled = string_array(&document, "disabled_mcp_servers")?;
    if source.id == "grok_project" {
        let user_path = grok_home().join("config.toml");
        if user_path.is_file() {
            if let Ok(user_raw) = read_text(&user_path) {
                if let Ok(user_document) = user_raw.parse::<DocumentMut>() {
                    if let Ok(names) = string_array(&user_document, "disabled_mcp_servers") {
                        disabled.extend(names);
                    }
                }
            }
        }
    }
    let mut entries = Vec::new();
    let Some(servers) = document.get("mcp_servers").and_then(|item| item.as_table_like()) else {
        return Ok(entries);
    };
    for (name, item) in servers.iter() {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let Some(table) = item.as_table_like() else {
            continue;
        };
        let spec = source_spec(source.id).expect("registered source");
        let enabled = table
            .get("enabled")
            .and_then(|item| item.as_bool())
            .unwrap_or(true)
            && !disabled.iter().any(|item| item == name);
        let command = table
            .get("command")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let url = table
            .get("url")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(redact_url);
        let transport = table
            .get("type")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let args_count = table
            .get("args")
            .and_then(|item| item.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        let mut env_keys: Vec<String> = table
            .get("env")
            .and_then(|item| item.as_table_like())
            .map(|table| table.iter().map(|(key, _)| key.to_string()).collect())
            .unwrap_or_default();
        env_keys.sort();
        let mut header_keys: Vec<String> = table
            .get("headers")
            .and_then(|item| item.as_table_like())
            .map(|table| table.iter().map(|(key, _)| key.to_string()).collect())
            .unwrap_or_default();
        header_keys.sort();
        entries.push(McpConfigEntry {
            id: format!("{}:{name}", source.id),
            engine: source.engine.to_string(),
            name: name.to_string(),
            source: source.id.to_string(),
            scope: source.scope.to_string(),
            path: path.to_string_lossy().into_owned(),
            format: "toml".to_string(),
            enabled,
            transport,
            command,
            args_count,
            url,
            env_keys,
            header_keys,
            writable: spec.writable,
            readonly_reason: spec.readonly_reason.map(str::to_string),
            readonly_reason_code: spec.readonly_reason_code.map(str::to_string),
            version: version.clone(),
        });
    }
    Ok(entries)
}

pub(super) fn string_array(document: &DocumentMut, key: &str) -> Result<Vec<String>, McpError> {
    match document.get(key) {
        None => Ok(Vec::new()),
        Some(item) => item
            .as_array()
            .map(|array| array.iter().filter_map(|item| item.as_str()).map(str::to_string).collect())
            .ok_or_else(|| McpError::format(format!("{key} 不是数组，未解析该字段"))),
    }
}

/// dsh：profile 的 cordis 配置里每个 `dsh-mcp-client` 插件实例就是一台 MCP
/// 服务；loader 条目的 `disabled` 就是启停开关。
pub(super) fn read_dsh_profile(path: &Path) -> Result<Vec<McpConfigEntry>, McpError> {
    let raw = read_text(path)?;
    let version = file_hash(raw.as_bytes());
    let root: serde_yaml::Value = serde_yaml::from_str(&raw)
        .map_err(|error| McpError::format(format!("{}: invalid YAML: {error}", path.display())))?;
    let spec = source_spec("dsh_profile").expect("registered source");
    let mut entries: Vec<McpConfigEntry> = Vec::new();
    let mut stack: Vec<(&serde_yaml::Value, usize)> = vec![(&root, 0)];
    while let Some((node, depth)) = stack.pop() {
        if depth > 4 {
            continue;
        }
        match node {
            serde_yaml::Value::Sequence(items) => {
                stack.extend(items.iter().map(|item| (item, depth + 1)));
            }
            serde_yaml::Value::Mapping(map) => {
                for key in ["insert", "before", "after"] {
                    if let Some(nested) = map.get(serde_yaml::Value::String(key.to_string())) {
                        stack.push((nested, depth + 1));
                    }
                }
                if map
                    .get(serde_yaml::Value::String("name".to_string()))
                    .and_then(serde_yaml::Value::as_str)
                    != Some(DSH_MCP_PLUGIN)
                {
                    continue;
                }
                let config = map.get(serde_yaml::Value::String("config".to_string()));
                let text = |key: &str| -> Option<String> {
                    config
                        .and_then(|config| config.get(serde_yaml::Value::String(key.to_string())))
                        .and_then(serde_yaml::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                };
                let name = text("serverName").or_else(|| {
                    map.get(serde_yaml::Value::String("id".to_string()))
                        .and_then(serde_yaml::Value::as_str)
                        .map(str::to_string)
                });
                let Some(name) = name else { continue };
                if entries.iter().any(|entry| entry.name == name) {
                    continue;
                }
                let disabled = map
                    .get(serde_yaml::Value::String("disabled".to_string()))
                    .and_then(serde_yaml::Value::as_bool)
                    .unwrap_or(false);
                let args_count = config
                    .and_then(|config| config.get(serde_yaml::Value::String("args".to_string())))
                    .and_then(serde_yaml::Value::as_sequence)
                    .map(Vec::len)
                    .unwrap_or(0);
                let env_keys = yaml_keys(config, "env");
                let header_keys = yaml_keys(config, "headers");
                entries.push(McpConfigEntry {
                    id: format!("dsh_profile:{name}"),
                    engine: "dsh".to_string(),
                    name,
                    source: "dsh_profile".to_string(),
                    scope: "user".to_string(),
                    path: path.to_string_lossy().into_owned(),
                    format: "yaml".to_string(),
                    enabled: !disabled,
                    transport: text("transport"),
                    command: text("command"),
                    args_count,
                    url: text("url").map(|url| redact_url(&url)),
                    env_keys,
                    header_keys,
                    writable: spec.writable,
                    readonly_reason: spec.readonly_reason.map(str::to_string),
                    readonly_reason_code: spec.readonly_reason_code.map(str::to_string),
                    version: version.clone(),
                });
            }
            _ => {}
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn yaml_keys(config: Option<&serde_yaml::Value>, key: &str) -> Vec<String> {
    let mut keys: Vec<String> = config
        .and_then(|config| config.get(serde_yaml::Value::String(key.to_string())))
        .and_then(serde_yaml::Value::as_mapping)
        .map(|map| {
            map.iter()
                .filter_map(|(key, _)| key.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    keys.sort();
    keys
}

