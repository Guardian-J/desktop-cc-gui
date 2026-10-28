import type { Message } from "@/lib/ipc";
import { findPlanMessage } from "./plan-review";

/**
 * What a settled turn hands to its OS notification (src/lib/notifications.ts).
 * A turn is everything after the last user row: the rows before it belong to
 * earlier turns, whose leftovers must not speak for this one.
 */

/** Index of the current turn's first row (0 when no user row exists). */
function turnStart(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}

/** The reply text this turn ended on, or "" when it wrote none — a tool-only
 *  turn must not resurface the previous turn's answer. */
export function turnReplyText(messages: readonly Message[]): string {
  const start = turnStart(messages);
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.text.trim()) return m.text;
  }
  return "";
}

/** Whether this turn left a card the user still has to act on: a question,
 *  a grant card or a plan awaiting review. notifyTurnComplete skips its own
 *  notice when that card's notice actually went out. */
export function turnAwaitsUser(messages: readonly Message[]): boolean {
  for (let i = turnStart(messages); i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "question" && m.question?.status === "pending") return true;
    if (m.role === "grant" && m.grant?.status === "pending") return true;
    if (m.planReview?.status === "awaiting_review") return true;
  }
  return false;
}

/** Status of one plan revision's card, or undefined before it is rendered. */
export function planRevisionStatus(
  messages: readonly Message[],
  planId: string,
  revision: number,
): string | undefined {
  const index = findPlanMessage(messages as Message[], planId, revision);
  return index >= 0 ? messages[index].planReview?.status : undefined;
}
