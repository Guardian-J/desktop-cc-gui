//! Claude applies settings.json env after inheriting the process environment.
//! A private --settings overlay makes a selected channel win at that same layer.

use super::{BuiltCommand, SendRequest};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

const ROUTING_KEYS: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
    "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
];

pub(super) fn resolve_model(
    selected: Option<&str>,
    provider: Option<&Value>,
    env: &HashMap<String, String>,
) -> Option<String> {
    let Some(provider) = provider else {
        return selected.map(super::models::resolve_claude_launch_model);
    };
    let configured = env
        .get("ANTHROPIC_MODEL")
        .map(String::as_str)
        .or_else(|| {
            provider
                .pointer("/settingsConfig/model")
                .and_then(Value::as_str)
        })
        .filter(|model| !model.trim().is_empty())
        .unwrap_or("default");
    let selected = selected.unwrap_or(configured);
    let raw = selected.strip_suffix("[1m]").unwrap_or(selected);
    let raw = if raw == "default" { configured } else { raw };
    let family = raw.strip_suffix("[1m]").unwrap_or(raw);
    let resolved = match family {
        "opus" | "sonnet" | "haiku" | "fable" => env
            .get(&format!(
                "ANTHROPIC_DEFAULT_{}_MODEL",
                family.to_uppercase()
            ))
            .map(String::as_str)
            .unwrap_or(raw),
        _ => raw,
    };
    let extended = selected.ends_with("[1m]") || raw.ends_with("[1m]");
    Some(if extended && !resolved.ends_with("[1m]") {
        format!("{resolved}[1m]")
    } else {
        resolved.to_string()
    })
}

pub(super) fn apply(
    built: &mut BuiltCommand,
    provider: &Value,
    env: &HashMap<String, String>,
    req: &SendRequest,
) -> Result<(), String> {
    stage(
        built,
        provider,
        env,
        req.model.as_deref(),
        &crate::paths::app_home().join("claude-staging"),
    )
}

fn stage(
    built: &mut BuiltCommand,
    provider: &Value,
    env: &HashMap<String, String>,
    model: Option<&str>,
    directory: &Path,
) -> Result<(), String> {
    let mut settings = provider
        .get("settingsConfig")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    // Empty values mask native routing/auth settings, while unrelated native
    // hooks, permissions and managed settings retain the CLI's own precedence.
    let mut overlay: Map<String, Value> = ROUTING_KEYS
        .iter()
        .map(|key| (key.to_string(), Value::String(String::new())))
        .collect();
    overlay.extend(
        env.iter()
            .map(|(key, value)| (key.clone(), Value::String(value.clone()))),
    );
    settings.insert("env".into(), Value::Object(overlay));
    settings.insert(
        "model".into(),
        Value::String(model.unwrap_or("default").to_string()),
    );
    settings
        .entry("apiKeyHelper")
        .or_insert(Value::String(String::new()));
    let content =
        serde_json::to_vec(&settings).map_err(|_| "Cannot serialize Claude channel settings")?;
    std::fs::create_dir_all(directory)
        .map_err(|e| format!("create Claude staging directory: {e}"))?;
    let path = directory.join(format!("channel-{}.json", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|e| format!("create private Claude settings: {e}"))?;
    built.cleanup_files.push(path.clone());
    file.write_all(&content)
        .map_err(|e| format!("write private Claude settings: {e}"))?;
    built.command.arg("--settings").arg(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built() -> BuiltCommand {
        BuiltCommand {
            command: tokio::process::Command::new("claude"),
            stdin_payload: None,
            cleanup_files: Vec::new(),
            preassigned_session_id: None,
        }
    }

    #[test]
    fn channel_models_never_resolve_through_native_aliases() {
        let provider = serde_json::json!({"model": "sonnet", "settingsConfig": {"model": "haiku"}});
        let env = HashMap::from([
            ("ANTHROPIC_MODEL".into(), "sonnet".into()),
            (
                "ANTHROPIC_DEFAULT_SONNET_MODEL".into(),
                "relay-model".into(),
            ),
        ]);
        for (selected, expected) in [
            (None, "relay-model"),
            (Some("default"), "relay-model"),
            (Some("sonnet"), "relay-model"),
            (Some("sonnet[1m]"), "relay-model[1m]"),
            (Some("custom-id"), "custom-id"),
            (Some("opus"), "opus"),
        ] {
            assert_eq!(
                resolve_model(selected, Some(&provider), &env).as_deref(),
                Some(expected)
            );
        }
        let empty = serde_json::json!({});
        assert_eq!(
            resolve_model(None, Some(&empty), &HashMap::new()).as_deref(),
            Some("default")
        );
        assert_eq!(
            resolve_model(Some("sonnet"), Some(&empty), &HashMap::new()).as_deref(),
            Some("sonnet")
        );
    }

    #[test]
    fn channel_settings_isolate_credentials_without_rewriting_native_files() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-claude-channel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let native = directory.join("settings.json");
        let original = r#"{"env":{"ANTHROPIC_BASE_URL":"https://native.invalid","ANTHROPIC_API_KEY":"test-native"},"hooks":{"Stop":[]}}"#;
        std::fs::write(&native, original).unwrap();
        let mut first = built();
        let mut second = built();
        for (command, name) in [(&mut first, "first"), (&mut second, "second")] {
            let provider = serde_json::json!({"baseUrl": format!("https://{name}.invalid"), "apiKey": format!("test-{name}"),
                "settingsConfig": {"alwaysThinkingEnabled": true, "env": {"CUSTOM_VALUE": "keep", "NODE_OPTIONS": "blocked"}}});
            let env = crate::provider_files::channel_env("claude", &provider).unwrap();
            stage(command, &provider, &env, Some("selected-model"), &directory).unwrap();
            let path = &command.cleanup_files[0];
            let settings: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            assert_eq!(
                settings["env"]["ANTHROPIC_BASE_URL"],
                format!("https://{name}.invalid")
            );
            assert_eq!(
                settings["env"]["ANTHROPIC_AUTH_TOKEN"],
                format!("test-{name}")
            );
            assert_eq!(settings["env"]["ANTHROPIC_API_KEY"], "");
            assert_eq!(settings["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"], "");
            assert_eq!(settings["env"]["CLAUDE_CODE_USE_BEDROCK"], "");
            assert_eq!(settings["env"]["CUSTOM_VALUE"], "keep");
            assert!(settings["env"].get("NODE_OPTIONS").is_none());
            assert_eq!(settings["apiKeyHelper"], "");
            assert_eq!(settings["model"], "selected-model");
            assert_eq!(settings["alwaysThinkingEnabled"], true);
            assert!(
                settings.get("hooks").is_none(),
                "Unrelated native settings are left to the CLI"
            );
            let args: Vec<_> = command.command.as_std().get_args().collect();
            assert_eq!(
                args,
                vec![std::ffi::OsStr::new("--settings"), path.as_os_str()]
            );
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
            }
        }
        assert_ne!(
            first.cleanup_files, second.cleanup_files,
            "Concurrent sends use separate overlays"
        );
        assert_eq!(std::fs::read_to_string(&native).unwrap(), original);
        super::super::cleanup_staged_files(&first.cleanup_files);
        assert!(!first.cleanup_files[0].exists());
        assert!(second.cleanup_files[0].exists());
        super::super::cleanup_staged_files(&second.cleanup_files);
        let mut failed = built();
        assert!(stage(&mut failed, &Value::Null, &HashMap::new(), None, &native).is_err());
        assert!(failed.cleanup_files.is_empty());
        assert_eq!(std::fs::read_to_string(&native).unwrap(), original);
        std::fs::remove_file(native).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
