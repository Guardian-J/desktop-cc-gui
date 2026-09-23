/**
 * MCP 连接检测结果（内存态，不落盘，模块级单例：设置页与 `/mcp` 面板共用）。
 *
 * 与 `useMcpInventory` 的运行时分区是两回事：运行时是某个 CLI 会话自己上报
 * 的连接状态，这里是**本应用发起**的一次检测。结果按条目标识 + 配置版本号
 * 存放：配置文件变了，旧结果就是过期数据，不再展示。
 *
 * 「检测全部」按条目顺序串行执行（逐个启动 stdio 服务），同一时刻只有一个
 * 检测在飞，避免多个 npx 抢占机器。
 */
import { create } from "zustand";
import { mcpApi } from "./api";
import type { McpConfigEntry, McpProbeState } from "./types";

interface McpProbeStore {
  /** 条目 id → 检测结果；`pending` 里的条目正在检测。 */
  results: Record<string, McpProbeState>;
  pending: Record<string, true>;
  /** 「检测全部」是否在跑（含队列）。 */
  runningAll: boolean;
  error: string | null;
  probe: (entry: McpConfigEntry, workspace: string | null) => Promise<void>;
  probeAll: (entries: McpConfigEntry[], workspace: string | null) => Promise<void>;
  clear: () => void;
}

/** 配置版本一致的旧结果才有效。 */
export function probeStateFor(
  results: Record<string, McpProbeState>,
  entry: McpConfigEntry,
): McpProbeState | null {
  const state = results[entry.id];
  if (!state || state.version !== entry.version) return null;
  return state;
}

/** 可以检测的条件：配置里真有命令或地址。 */
export function probeable(entry: McpConfigEntry): boolean {
  return Boolean(entry.command || entry.url);
}

export const useMcpProbeStore = create<McpProbeStore>((set, get) => ({
  results: {},
  pending: {},
  runningAll: false,
  error: null,

  probe: async (entry, workspace) => {
    if (!probeable(entry)) return;
    set((state) => ({ pending: { ...state.pending, [entry.id]: true }, error: null }));
    try {
      const result = await mcpApi.probe(entry, workspace);
      set((state) => ({
        results: {
          ...state.results,
          [entry.id]: { result, checkedAt: Date.now(), version: entry.version },
        },
      }));
    } catch (probeError) {
      set({
        error: probeError instanceof Error ? probeError.message : String(probeError),
      });
    } finally {
      set((state) => {
        const pending = { ...state.pending };
        delete pending[entry.id];
        return { pending };
      });
    }
  },

  probeAll: async (entries, workspace) => {
    const targets = entries.filter(probeable);
    if (targets.length === 0 || get().runningAll) return;
    set({ runningAll: true, error: null });
    try {
      // 串行：stdio 服务同时拉起会抢 CPU，也难看清是谁失败。
      for (const entry of targets) {
        await get().probe(entry, workspace);
      }
    } finally {
      set({ runningAll: false });
    }
  },

  clear: () => set({ results: {}, error: null }),
}));
