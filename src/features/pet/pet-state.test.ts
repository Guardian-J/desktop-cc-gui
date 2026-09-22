import { describe, expect, it } from "vitest";
import { derivePetState } from "./pet-state";

const chat = (session: Record<string, unknown>) => ({ bySession: { current: session } }) as never;
const mission = (runs: Record<string, unknown>) => ({ runs }) as never;

describe("pet state aggregation", () => {
  it("prioritizes failures over waiting and running", () => {
    expect(
      derivePetState(
        chat({
          error: "failed",
          streaming: true,
          backgroundActive: true,
          awaitingTasks: true,
          tasks: [],
        }),
        mission({}),
      ).status,
    ).toBe("failed");
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
});
