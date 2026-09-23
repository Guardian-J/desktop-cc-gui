import { describe, expect, it } from "vitest";
import type { SkillRow } from "./types";
import {
  filterSkills,
  formatTokens,
  hasOrphanCopy,
  sortSkills,
  sourceKindOf,
  summarizeTargetResults,
  syncedTargets,
} from "./utils";

function skill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "local:alpha",
    key: "local:alpha",
    name: "Alpha",
    description: "does things",
    directory: "alpha",
    readmeUrl: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    installedAt: null,
    managed: false,
    sourceKind: "local",
    readonly: false,
    targets: ["claude"],
    targetStates: { claude: "synced", codex: "off" },
    ...overrides,
  };
}

describe("skills utils", () => {
  it("classifies legacy payloads without sourceKind", () => {
    expect(sourceKindOf({ managed: true, sourceKind: undefined as never })).toBe(
      "managed",
    );
    expect(sourceKindOf({ managed: false, sourceKind: undefined as never })).toBe(
      "local",
    );
  });

  it("filters by query, source and target state", () => {
    const rows = [
      skill({ id: "a", name: "Alpha", sourceKind: "managed", managed: true }),
      skill({ id: "b", name: "Beta", sourceKind: "local" }),
      skill({
        id: "c",
        name: "Gamma",
        sourceKind: "builtin",
        readonly: true,
        targetStates: { claude: "off", codex: "off" },
      }),
    ];
    expect(filterSkills(rows, { query: "bet", source: "", target: "" })).toHaveLength(1);
    expect(filterSkills(rows, { query: "", source: "builtin", target: "" })).toHaveLength(1);
    expect(filterSkills(rows, { query: "", source: "", target: "claude" })).toHaveLength(2);
    expect(
      filterSkills(rows, { query: "gamma", source: "", target: "claude" }),
    ).toHaveLength(0);
  });

  it("sorts managed first, then by name", () => {
    const rows = [
      skill({ id: "z", name: "zeta" }),
      skill({ id: "a", name: "alpha", managed: true, sourceKind: "managed" }),
      skill({ id: "m", name: "mid" }),
    ];
    expect(sortSkills(rows).map((row) => row.name)).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("summarizes per-target results without hiding partial failures", () => {
    expect(summarizeTargetResults(undefined).allOk).toBe(true);
    const partial = summarizeTargetResults([
      { target: "claude", ok: true, error: null },
      { target: "codex", ok: false, error: "permission denied" },
    ]);
    expect(partial.allOk).toBe(false);
    expect(partial.failed).toEqual([{ target: "codex", error: "permission denied" }]);
  });

  it("reports synced targets and orphan copies", () => {
    const row = skill({
      targets: ["claude", "codex"],
      targetStates: { claude: "synced", codex: "orphan" },
    });
    expect(syncedTargets(row)).toEqual(["claude"]);
    expect(hasOrphanCopy(row)).toBe(true);
  });

  it("formats token counts compactly", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(12_300)).toBe("12.3k");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(null)).toBe("0");
  });
});
