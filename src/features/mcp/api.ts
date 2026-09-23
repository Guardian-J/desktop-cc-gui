/**
 * MCP transport: `mcp_inventory` / `mcp_set_enabled` with normalized errors.
 * Both commands are desktop-only (the web bridge does not dispatch them), so
 * the page shows a local-management notice under `isWeb`.
 */
import { invoke } from "@/lib/transport";
import type { McpConfigEntry, McpErrorCode, McpInventory } from "./types";

export class McpHubError extends Error {
  readonly code: McpErrorCode;
  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpHubError";
    this.code = code;
  }
}

function normalize(error: unknown): McpHubError {
  if (error instanceof McpHubError) return error;
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    return new McpHubError(
      typeof record.code === "string" ? (record.code as McpErrorCode) : "internal",
      typeof record.message === "string" ? record.message : String(error),
    );
  }
  return new McpHubError("internal", String(error));
}

export const mcpApi = {
  inventory: async (workspace: string | null): Promise<McpInventory> => {
    try {
      return await invoke<McpInventory>("mcp_inventory", { workspace });
    } catch (error) {
      throw normalize(error);
    }
  },
  setEnabled: async (
    entry: McpConfigEntry,
    enabled: boolean,
    workspace: string | null,
  ): Promise<McpConfigEntry> => {
    try {
      return await invoke<McpConfigEntry>("mcp_set_enabled", {
        request: {
          entryId: entry.id,
          enabled,
          version: entry.version,
          workspace,
        },
      });
    } catch (error) {
      throw normalize(error);
    }
  },
};
