/**
 * Pure helpers for the Skills page: source classification, filtering and
 * per-target result summaries. Kept free of React and IPC so the rules are
 * unit-testable.
 */
import type {
  SkillRow,
  SkillSourceKind,
  SkillTargetId,
  SkillTargetResult,
} from "./types";

/** Legacy payloads (and manage-only entries) carry `managed` but no
 *  `sourceKind`; never show `undefined` as a source badge. */
export function sourceKindOf(skill: Pick<SkillRow, "managed" | "sourceKind">): SkillSourceKind {
  if (skill.sourceKind) return skill.sourceKind;
  return skill.managed ? "managed" : "local";
}

export interface SkillFilter {
  query: string;
  /** "" = all sources. */
  source: SkillSourceKind | "";
  /** "" = all engines. */
  target: SkillTargetId | "";
}

export function filterSkills(skills: SkillRow[], filter: SkillFilter): SkillRow[] {
  const needle = filter.query.trim().toLowerCase();
  return skills.filter((skill) => {
    if (filter.source && sourceKindOf(skill) !== filter.source) return false;
    if (filter.target) {
      const state = skill.targetStates?.[filter.target] ?? "off";
      if (state === "off") return false;
    }
    if (needle) {
      const haystack = `${skill.name}\n${skill.description}\n${skill.directory}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Managed entries first (the app owns them), then by name — stable across
 *  refreshes because the backend already sorts by name. */
export function sortSkills(skills: SkillRow[]): SkillRow[] {
  return [...skills].sort((a, b) => {
    const aManaged = sourceKindOf(a) === "managed" ? 0 : 1;
    const bManaged = sourceKindOf(b) === "managed" ? 0 : 1;
    if (aManaged !== bManaged) return aManaged - bManaged;
    return a.name.localeCompare(b.name);
  });
}

export interface TargetResultSummary {
  allOk: boolean;
  failed: { target: string; error: string | null }[];
}

/** "全部同步完成" only when every target succeeded; a partial failure keeps
 *  the failed target visible instead of collapsing into a generic error. */
export function summarizeTargetResults(
  results: SkillTargetResult[] | undefined,
): TargetResultSummary {
  const failed = (results ?? [])
    .filter((result) => !result.ok)
    .map((result) => ({ target: result.target, error: result.error }));
  return { allOk: failed.length === 0, failed };
}

/** Which engine copies exist right now (`synced` only). */
export function syncedTargets(skill: SkillRow): SkillTargetId[] {
  return (skill.targets ?? []).filter(
    (target) => (skill.targetStates?.[target] ?? "synced") === "synced",
  );
}

export function hasOrphanCopy(skill: SkillRow): boolean {
  return Object.values(skill.targetStates ?? {}).some((state) => state === "orphan");
}

/** Compact token count for the usage table (12.3k / 1.2M). */
export function formatTokens(value: number | null | undefined): string {
  const tokens = value ?? 0;
  if (tokens < 1000) return String(tokens);
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
