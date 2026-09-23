/**
 * MCP inventory IPC types — mirror `src-tauri/src/mcp/mod.rs` (camelCase).
 * Config and runtime are separate sections by design: "enabled in config" and
 * "connected in a session" must never be collapsed into one state.
 */

export type McpEngineId = "claude" | "codex";

export type McpConfigSource =
  | "claude_user"
  | "claude_local"
  | "claude_project"
  | "codex_user"
  | "codex_project";

export interface McpConfigEntry {
  /** Backend-generated id (`source:name`); the UI only echoes it back. */
  id: string;
  engine: McpEngineId;
  name: string;
  source: McpConfigSource;
  scope: "user" | "project";
  path: string;
  format: "json" | "toml";
  enabled: boolean;
  transport: string | null;
  command: string | null;
  argsCount: number;
  /** Redacted by the backend (userinfo + sensitive query values). */
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  writable: boolean;
  readonlyReason: string | null;
  /** Content hash at read time; a mismatch on write means an external edit. */
  version: string;
}

export interface McpSourceError {
  source: string;
  path: string;
  message: string;
}

export interface McpConfigSection {
  entries: McpConfigEntry[];
  errors: McpSourceError[];
}

export type McpRuntimeStatus =
  | "ready"
  | "no_session"
  | "session_ended"
  | "unsupported"
  | "unavailable";

export interface McpRuntimeEntry {
  name: string;
  status: string | null;
  builtin: boolean;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
}

export interface McpRuntimeSection {
  status: McpRuntimeStatus;
  reason: string | null;
  workspace: string | null;
  sessionId: string | null;
  collectedAt: number | null;
  entries: McpRuntimeEntry[];
}

export interface McpEngineInventory {
  id: McpEngineId;
  available: boolean;
  config: McpConfigSection;
  runtime: McpRuntimeSection;
}

export interface McpInventory {
  engines: McpEngineInventory[];
  collectedAt: number;
}

export type McpErrorCode =
  | "readonly"
  | "conflict"
  | "not_found"
  | "format"
  | "permission"
  | "invalid_input"
  | "internal";
