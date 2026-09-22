import { describe, expect, it } from "vitest";
import {
  atlasBackgroundPosition,
  atlasFrame,
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_STATUS_ROWS,
} from "./pet-atlas";

describe("pet v2 atlas", () => {
  it("uses the standard 192x208 cells and action rows", () => {
    expect([PET_CELL_WIDTH, PET_CELL_HEIGHT]).toEqual([192, 208]);
    expect(PET_STATUS_ROWS).toMatchObject({ idle: 0, running: 7, waiting: 6, failed: 5, review: 8 });
    expect(atlasFrame("running", 9)).toEqual({ row: 7, column: 1 });
  });

  it("keeps animation frames inside the 8-column sheet", () => {
    expect(atlasBackgroundPosition("failed", 10)).toBe("-384px -1040px");
  });
});
