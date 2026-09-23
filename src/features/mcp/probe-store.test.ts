import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfigEntry, McpProbeResult } from "./types";

const api = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("./api", () => ({ mcpApi: api }));

import { probeable, probeStateFor, useMcpProbeStore } from "./probe-store";

function entry(overrides: Partial<McpConfigEntry> = {}): McpConfigEntry {
  return {
    id: "claude_user:alpha",
    engine: "claude",
    name: "alpha",
    source: "claude_user",
    scope: "user",
    path: "/home/u/.claude.json",
    format: "json",
    enabled: true,
    transport: "stdio",
    command: "npx",
    argsCount: 1,
    url: null,
    envKeys: [],
    headerKeys: [],
    writable: true,
    readonlyReason: null,
    version: "v1",
    ...overrides,
  };
}

function connected(tools: string[] = []): McpProbeResult {
  return {
    status: "connected",
    message: null,
    tools,
    serverName: "fake",
    protocolVersion: "2025-06-18",
    elapsedMs: 4,
  };
}

describe("probe store", () => {
  beforeEach(() => {
    api.probe.mockReset();
    useMcpProbeStore.setState({
      results: {},
      pending: {},
      runningAll: false,
      error: null,
    });
  });

  it("only entries with a command or url are checkable", () => {
    expect(probeable(entry())).toBe(true);
    expect(probeable(entry({ command: null, url: "https://x/mcp" }))).toBe(true);
    expect(probeable(entry({ command: null, url: null }))).toBe(false);
  });

  it("drops results whose config version changed", () => {
    const state = { result: connected(), checkedAt: 1, version: "v1" };
    expect(probeStateFor({ [entry().id]: state }, entry())).toBe(state);
    expect(probeStateFor({ [entry().id]: state }, entry({ version: "v2" }))).toBeNull();
    expect(probeStateFor({}, entry())).toBeNull();
  });

  it("records pending then the result, and survives a failure", async () => {
    let release: (value: McpProbeResult) => void = () => {};
    api.probe.mockImplementationOnce(
      () => new Promise<McpProbeResult>((resolve) => (release = resolve)),
    );
    const probing = useMcpProbeStore.getState().probe(entry(), null);
    expect(useMcpProbeStore.getState().pending[entry().id]).toBe(true);
    release(connected(["a"]));
    await probing;
    const state = useMcpProbeStore.getState();
    expect(state.pending[entry().id]).toBeUndefined();
    expect(state.results[entry().id].result.tools).toEqual(["a"]);
    expect(state.results[entry().id].version).toBe("v1");

    api.probe.mockRejectedValueOnce(new Error("boom"));
    await useMcpProbeStore.getState().probe(entry(), null);
    expect(useMcpProbeStore.getState().error).toBe("boom");
  });

  it("checks every checkable entry serially, one at a time", async () => {
    let active = 0;
    let maxActive = 0;
    api.probe.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return connected();
    });
    await useMcpProbeStore.getState().probeAll(
      [
        entry({ id: "a:one", name: "one" }),
        entry({ id: "b:two", name: "two", command: null, url: null }),
        entry({ id: "c:three", name: "three" }),
      ],
      null,
    );
    expect(api.probe).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(useMcpProbeStore.getState().runningAll).toBe(false);
    // 二次进入时正在跑的全部检测不会被叠起来。
    expect(Object.keys(useMcpProbeStore.getState().results)).toHaveLength(2);
  });
});
