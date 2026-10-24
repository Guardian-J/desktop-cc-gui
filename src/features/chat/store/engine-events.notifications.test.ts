import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEngineEvents, settledRuns, type EngineEventDeps } from "./engine-events";
import type { Message } from "@/lib/ipc";
import type { ChatStore } from "./types";
import { EMPTY_SESSION, runRouting } from "./stream";
import * as notifications from "@/lib/notifications";

vi.mock("@/lib/notifications", () => ({
  notifyTurnComplete: vi.fn(),
  notifyInterrupted: vi.fn(),
  notifyTurnError: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyPlanReview: vi.fn(),
  notifyPermissionRequest: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    rescanSessions: vi.fn(async () => []),
    usageRecord: vi.fn(async () => {}),
    grantScope: vi.fn(async (path: string) => path),
  },
}));

describe("engine-events notifications", () => {
  const KEY = "claude:s-1:/ws";

  beforeEach(() => {
    vi.clearAllMocks();
    settledRuns.clear();
    runRouting.clear();
  });

  function createDeps(initialInterrupted = false, runId = "r-1") {
    runRouting.set(runId, KEY);
    const messages: Message[] = [
      { role: "user", text: "hi", ts: "1", seq: 1 },
      { role: "assistant", text: "hello world", ts: "2", seq: 2 },
    ];
    const session = {
      ...EMPTY_SESSION,
      interrupted: initialInterrupted,
      streaming: true,
      messages,
    };
    const state = {
      bySession: { [KEY]: session },
      openTabs: [],
      streamingByKey: { [KEY]: true },
      retryingByKey: {},
      models: {},
      efforts: {},
    };
    const deps: EngineEventDeps = {
      set: (fn) => {
        const patch = typeof fn === "function" ? fn(state as unknown as ChatStore) : fn;
        Object.assign(state, patch);
        if (patch.bySession?.[KEY]) {
          state.bySession[KEY] = { ...state.bySession[KEY], ...patch.bySession[KEY] };
        }
      },
      get: () => state as unknown as ChatStore,
      drainQueue: vi.fn(),
      markUnseenIfBackground: vi.fn(),
      upsertSessionMeta: vi.fn(),
    };
    return { state, deps };
  }

  it("triggers notifyTurnComplete on normal onDone when not interrupted", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "done", data: { usage: null } }],
      deps,
    );
    expect(notifications.notifyTurnComplete).toHaveBeenCalledWith(KEY, "hello world");
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
  });

  it("does NOT trigger notifyInterrupted onDone when user manually interrupted", () => {
    const { deps } = createDeps(true);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "done", data: { usage: null } }],
      deps,
    );
    expect(notifications.notifyTurnComplete).not.toHaveBeenCalled();
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
  });

  it("does NOT trigger notifications onError when user manually interrupted", () => {
    const { deps } = createDeps(true);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "error", data: "stream closed" }],
      deps,
    );
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
  });

  it("triggers notifyInterrupted onError when API/stream is disconnected and user did not interrupt", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "error", data: "dsh 会话流中断：连接超时" }],
      deps,
    );
    expect(notifications.notifyInterrupted).toHaveBeenCalledWith(KEY, "dsh 会话流中断：连接超时");
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
  });

  it("triggers notifyTurnError onError on general errors when user did not interrupt", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "error", data: "401 Unauthorized" }],
      deps,
    );
    expect(notifications.notifyTurnError).toHaveBeenCalledWith(KEY, "401 Unauthorized");
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
  });

  it("triggers notifyQuestion on a pending question card", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [
        {
          runId: "r-1",
          sessionId: "s-1",
          engine: "claude",
          seq: 3,
          kind: "question",
          data: {
            requestId: "q-1",
            input: {
              questions: [
                { question: "是否删除该文件？", header: "确认", options: [{ label: "Yes" }, { label: "No" }] },
              ],
            },
          },
        },
      ],
      deps,
    );
    expect(notifications.notifyQuestion).toHaveBeenCalledWith(KEY, "是否删除该文件？");
  });

  it("does NOT trigger notifyQuestion for a replayed (duplicate) question frame", () => {
    const { deps } = createDeps(false);
    const event = {
      runId: "r-1",
      sessionId: "s-1",
      engine: "claude",
      seq: 3,
      kind: "question" as const,
      data: {
        requestId: "q-1",
        input: {
          questions: [
            { question: "是否删除该文件？", header: "确认", options: [{ label: "Yes" }, { label: "No" }] },
          ],
        },
      },
    };
    handleEngineEvents([event], deps);
    handleEngineEvents([event], deps);
    expect(notifications.notifyQuestion).toHaveBeenCalledTimes(1);
  });

  it("triggers notifyPermissionRequest on a pending grant card", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [
        {
          runId: "r-1",
          sessionId: "s-1",
          engine: "claude",
          seq: 3,
          kind: "permission_denied",
          data: { tool: "Bash", path: "/src/sensitive" },
        },
      ],
      deps,
    );
    expect(notifications.notifyPermissionRequest).toHaveBeenCalledWith(KEY, "/src/sensitive");
  });

  it("does NOT trigger notifyPermissionRequest for a duplicate grant card", () => {
    const { deps } = createDeps(false);
    const event = {
      runId: "r-1",
      sessionId: "s-1",
      engine: "claude",
      seq: 3,
      kind: "permission_denied" as const,
      data: { tool: "Bash", path: "/src/sensitive" },
    };
    handleEngineEvents([event], deps);
    // The same denial rides the run twice (mid-turn tool_result, then the
    // final result's permission_denials): the still-pending card makes the
    // second frame a duplicate, so no second notification may fire.
    handleEngineEvents([{ ...event, seq: 4 }], deps);
    expect(notifications.notifyPermissionRequest).toHaveBeenCalledTimes(1);
  });

  it("triggers notifyPlanReview when a plan revision enters awaiting_review", () => {
    const { deps } = createDeps(false);
    const record = {
      planId: "p-1",
      engine: "claude",
      sessionId: "s-1",
      workspacePath: "/ws",
      runId: "r-1",
      revision: 1,
      title: "实施方案A",
      content: "# 方案",
      contentHash: "h1",
      complete: true,
      reviewKind: "plan" as const,
      nativePlanId: null,
      execPermission: "default",
      status: "awaiting_review" as const,
      execution: "pending" as const,
      decisionIntentAt: null,
      appliedAt: null,
      createdAt: 1,
      updatedAt: 2,
      supersededBy: null,
    };
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "plan_review", data: record }],
      deps,
    );
    expect(notifications.notifyPlanReview).toHaveBeenCalledWith(KEY, "实施方案A");
  });

  it("does NOT trigger notifyPlanReview for non-awaiting statuses", () => {
    const { deps } = createDeps(false);
    const record = {
      planId: "p-1",
      engine: "claude",
      sessionId: "s-1",
      workspacePath: "/ws",
      runId: "r-1",
      revision: 1,
      title: "实施方案A",
      content: "# 方案",
      contentHash: "h1",
      complete: true,
      reviewKind: "plan" as const,
      nativePlanId: null,
      execPermission: "default",
      status: "approved" as const,
      execution: "pending" as const,
      decisionIntentAt: null,
      appliedAt: null,
      createdAt: 1,
      updatedAt: 2,
      supersededBy: null,
    };
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "plan_review", data: record }],
      deps,
    );
    expect(notifications.notifyPlanReview).not.toHaveBeenCalled();
  });
});
