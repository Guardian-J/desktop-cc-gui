import type { ChatStore } from "@/features/chat/store/types";
import type { SessionState } from "@/features/chat/store/stream";
import { sessionKey } from "@/features/chat/store/persistence";
import type { MissionRun } from "@/features/mission/types";
import { runStatus } from "@/features/mission/types";
import type { PetStatus } from "./pet-atlas";

export type PetActivity =
  | "idle"
  | "thinking"
  | "tool"
  | "command"
  | "waiting"
  | "failed"
  | "completed";

export interface PetStateSnapshot {
  /** Stable identity used by the runtime when several sessions are active. */
  sessionKey: string | null;
  /** customTitle first, then the generated/session title; null for unnamed workbench runs. */
  sessionName: string | null;
  status: PetStatus;
  lookDirection: number;
  activity: PetActivity;
}

type PetChatState = Pick<ChatStore, "bySession"> &
  Partial<Pick<ChatStore, "sessions">>;

const COMMAND_SIGNAL = /\b(command|shell|terminal|powershell|bash|cmd|exec|run)\b/i;

function isCommandTask(task: {
  taskType: string;
  description: string;
  progress?: string;
  lastTool?: string;
}): boolean {
  return [task.taskType, task.description, task.progress, task.lastTool]
    .filter((value): value is string => Boolean(value))
    .some((value) => COMMAND_SIGNAL.test(value));
}

function runningActivity(sessions: SessionState[]): PetActivity {
  const runningTasks = sessions.flatMap((session) =>
    session.tasks.filter((task) => task.status === "running"),
  );
  if (runningTasks.some(isCommandTask)) return "command";

  const hasLiveThinking = sessions.some((session) =>
    session.messages.some((message) => message.role === "thinking" && message.live),
  );
  if (hasLiveThinking) return "thinking";

  const hasToolMessage = sessions.some((session) => {
    const last = session.messages[session.messages.length - 1];
    return last?.role === "tool";
  });
  if (hasToolMessage || runningTasks.length > 0) return "tool";
  return "thinking";
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

function sessionNameFromState(session: SessionState): string | null {
  const firstUser = session.messages?.find(
    (message) => message.role === "user" && message.text.trim(),
  );
  const title = firstUser?.text.replace(/\s+/g, " ").trim().slice(0, 40);
  return title || null;
}

function stateForSession(
  key: string,
  session: SessionState,
  sessionName: string | null,
): PetStateSnapshot | null {
  const base = {
    sessionKey: key,
    sessionName,
    lookDirection: 0,
  } as const;
  if (session.streaming || session.backgroundActive) {
    return { ...base, status: "running", activity: runningActivity([session]) };
  }
  if (session.error || session.tasks.some((task) => taskIsFailed(task.status))) {
    return { ...base, status: "failed", activity: "failed" };
  }
  if (session.awaitingTasks) {
    return { ...base, status: "waiting", activity: "waiting" };
  }
  return null;
}

function statePriority(status: PetStatus): number {
  if (status === "failed") return 4;
  if (status === "waiting") return 3;
  if (status === "running") return 2;
  if (status === "review") return 1;
  return 0;
}

/** Derive one status per active session so the overlay can distinguish them. */
export function derivePetStates(
  chat: PetChatState,
  mission: { runs: Record<string, MissionRun> },
): PetStateSnapshot[] {
  const metadataByKey = new Map(
    (chat.sessions ?? []).map((meta) => [
      sessionKey(meta.engine, meta.sessionId, meta.workspacePath),
      meta,
    ]),
  );
  const keys = [
    ...(chat.sessions ?? []).map((meta) =>
      sessionKey(meta.engine, meta.sessionId, meta.workspacePath),
    ),
    ...Object.keys(chat.bySession),
  ].filter((key, index, all) => all.indexOf(key) === index);

  const states: PetStateSnapshot[] = [];
  for (const key of keys) {
    const session = chat.bySession[key];
    if (!session) continue;
    const meta = metadataByKey.get(key);
    const sessionName =
      meta?.customTitle?.trim() || meta?.title?.trim() || sessionNameFromState(session);
    const state = stateForSession(key, session, sessionName || null);
    if (state) states.push(state);
  }

  const missionStatus = missionPetStatus(mission.runs);
  if (missionStatus) {
    states.push({
      sessionKey: "__mission__",
      sessionName: null,
      status: missionStatus,
      lookDirection: 0,
      activity:
        missionStatus === "failed"
          ? "failed"
          : missionStatus === "waiting"
            ? "waiting"
            : missionStatus === "running"
              ? "tool"
              : "completed",
    });
  }
  return states;
}

export function derivePetState(
  chat: PetChatState,
  mission: { runs: Record<string, MissionRun> },
): PetStateSnapshot {
  const states = derivePetStates(chat, mission);
  return (
    states.slice().sort((a, b) => statePriority(b.status) - statePriority(a.status))[0] ?? {
      sessionKey: null,
      sessionName: null,
      status: "idle",
      lookDirection: 0,
      activity: "idle",
    }
  );
}
