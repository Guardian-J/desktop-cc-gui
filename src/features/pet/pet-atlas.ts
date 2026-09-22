export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;
export const PET_COLUMNS = 8;
export const PET_ROWS = 11;

export type PetStatus = "idle" | "running" | "waiting" | "failed" | "review";

/** Standard Codex v2 rows. Rows 9 and 10 are the 16 clockwise directions. */
export const PET_STATUS_ROWS: Record<PetStatus, number> = {
  idle: 0,
  running: 7,
  waiting: 6,
  failed: 5,
  review: 8,
};

export interface PetAtlasPackage {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: number;
  spritesheetPath: string;
  spritesheetDataUrl: string;
}

export function atlasRow(status: PetStatus, lookDirection: number): number {
  if (status !== "idle" && status !== "running" && status !== "waiting" && status !== "failed" && status !== "review") {
    return PET_STATUS_ROWS.idle;
  }
  // Direction 0 is the v2 up-facing direction. Status rows are intentionally
  // preferred: the standard action rows carry their own side-facing frames.
  void lookDirection;
  return PET_STATUS_ROWS[status];
}

export function atlasFrame(
  status: PetStatus,
  frame: number,
  lookDirection = 0,
): { row: number; column: number } {
  if (status === "idle") {
    const direction = ((lookDirection % 16) + 16) % 16;
    return { row: 9 + Math.floor(direction / 8), column: direction % 8 };
  }
  const row = atlasRow(status, lookDirection);
  return { row, column: ((frame % PET_COLUMNS) + PET_COLUMNS) % PET_COLUMNS };
}

export function atlasBackgroundPosition(
  status: PetStatus,
  frame: number,
  lookDirection = 0,
): string {
  const { row, column } = atlasFrame(status, frame, lookDirection);
  return `${-column * PET_CELL_WIDTH}px ${-row * PET_CELL_HEIGHT}px`;
}
