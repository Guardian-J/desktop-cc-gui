import type { ChatStore } from "@/features/chat/store/types";
import type { MissionRun } from "@/features/mission/types";
import { runStatus } from "@/features/mission/types";
import type { PetStatus } from "./pet-atlas";

export interface PetStateSnapshot {
  status: PetStatus;
  lookDirection: number;
}

function missionPetStatus(runs: Record<string, MissionRun>): PetStatus | null {
  let hasDone = false;
  for (const run of Object.values(runs)) {
    if (run.tasks.some((task) => task.status === "failed" || task.status === "cancelled")) {
      return "failed";
    }
    if (run.tasks.some((task) => task.status === "waiting_human")) return "waiting";
    const status = runStatus(run);
    if (status === "attention") return "waiting";
    if (status === "running") return "running";
    if (status === "waiting") return "waiting";
    if (status === "done") hasDone = true;
  }
  return hasDone ? "review" : null;
}

function taskIsFailed(status: string): boolean {
  return status === "failed" || status === "cancelled" || status === "interrupted";
}

export function derivePetState(
  chat: Pick<ChatStore, "bySession">,
  mission: { runs: Record<string, MissionRun> },
): PetStateSnapshot {
  const sessions = Object.values(chat.bySession);
  const hasError = sessions.some((session) => session.error || session.tasks.some((task) => taskIsFailed(task.status)));
  if (hasError) return { status: "failed", lookDirection: 0 };

  const hasWaiting = sessions.some((session) => session.awaitingTasks);
  if (hasWaiting) return { status: "waiting", lookDirection: 0 };

  const hasRunning = sessions.some(
    (session) => session.streaming || session.backgroundActive,
  );
  if (hasRunning) return { status: "running", lookDirection: 0 };

  const missionResult = missionPetStatus(mission.runs);
  if (missionResult) return { status: missionResult, lookDirection: 0 };
  return { status: "idle", lookDirection: 0 };
}
