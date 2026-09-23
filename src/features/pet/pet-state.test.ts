import { describe, expect, it } from "vitest";
import { derivePetState, derivePetStates } from "./pet-state";

const chat = (session: Record<string, unknown>) => ({ bySession: { current: session } }) as never;
const mission = (runs: Record<string, unknown>) => ({ runs }) as never;

describe("pet state aggregation", () => {
  it("works on the v1.0.8 session shape without PR #1266 task signals", () => {
    const state = derivePetState(
      chat({
        error: null,
        streaming: true,
        messages: [{ role: "thinking", text: "正在分析", live: true }],
      }),
      mission({}),
    );

    expect(state.status).toBe("running");
    expect(state.activity).toBe("thinking");
  });

  it("prioritizes terminal failures over waiting", () => {
    expect(
      derivePetState(
        chat({
          error: null,
          streaming: false,
          backgroundActive: false,
          awaitingTasks: true,
          tasks: [{ status: "failed" }],
        }),
        mission({}),
      ).status,
    ).toBe("failed");
  });

  it("shows resumed session activity after a child task failed", () => {
    expect(
      derivePetState(
        chat({
          error: null,
          streaming: true,
          backgroundActive: false,
          awaitingTasks: false,
          tasks: [{ status: "failed" }],
          messages: [],
        }),
        mission({}),
      ).status,
    ).toBe("running");
  });

  it("includes mission runs when chat is idle", () => {
    expect(
      derivePetState(
        chat({ error: null, streaming: false, backgroundActive: false, awaitingTasks: false, tasks: [] }),
        mission({
          run: {
            endedAt: undefined,
            cancelled: false,
            interrupted: false,
            tasks: [{ status: "waiting_human" }],
          },
        }),
      ).status,
    ).toBe("waiting");
  });

  it("keeps concurrent session names attached to their own states", () => {
    const session = (text: string) => ({
      messages: [{ role: "thinking", text, live: true }],
      error: null,
      streaming: true,
      backgroundActive: false,
      awaitingTasks: false,
      tasks: [],
    });
    const states = derivePetStates(
      {
        bySession: {
          "claude/session-a": session("A"),
          "claude/session-b": session("B"),
        },
        sessions: [
          {
            engine: "claude",
            sessionId: "session-a",
            workspacePath: "E:/a",
            title: "会话 A",
            customTitle: null,
          },
          {
            engine: "claude",
            sessionId: "session-b",
            workspacePath: "E:/b",
            title: "会话 B",
            customTitle: null,
          },
        ],
      } as never,
      mission({}),
    );

    expect(states.map((state) => [state.sessionKey, state.sessionName])).toEqual([
      ["claude/session-a", "会话 A"],
      ["claude/session-b", "会话 B"],
    ]);
  });
});
