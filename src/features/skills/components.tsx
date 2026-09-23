/**
 * Shared bits for the Skills panes: source/sync badges, feedback banner and
 * small formatting helpers. Pure display — no data loading here.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Check from "lucide-react/dist/esm/icons/check";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import { cx } from "@/utils/cx";
import type { SkillRow, SkillSourceKind, SkillTargetInfo } from "./types";
import { hasOrphanCopy, sourceKindOf } from "./utils";

const BADGE_BASE =
  "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1";

const SOURCE_TONE: Record<SkillSourceKind, string> = {
  managed: "bg-accent-50 text-accent-700 ring-accent-200 dark:bg-accent-950/40 dark:text-accent-300 dark:ring-accent-800/60",
  local: "bg-background-tertiary-default text-text-secondary ring-separator-border",
  builtin: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60",
  system: "bg-background-tertiary-default text-text-secondary ring-separator-border",
  plugin: "bg-background-tertiary-default text-text-secondary ring-separator-border",
};

export function SourceBadge({ skill }: { skill: SkillRow }) {
  const { t } = useTranslation();
  const kind = sourceKindOf(skill);
  return (
    <span className={cx(BADGE_BASE, SOURCE_TONE[kind])} data-source-kind={kind}>
      {t(`skills.source.${kind}`)}
    </span>
  );
}

/** One dot per engine target: filled = synced, hollow red = orphan, dim =
 *  absent. Titles carry the engine name so the dots are not color-only. */
export function TargetDots({
  skill,
  targets,
}: {
  skill: SkillRow;
  targets: SkillTargetInfo[];
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1">
      {targets.map((target) => {
        const state = skill.targetStates?.[target.id] ?? "off";
        const label = t(`skills.targetState.${state}`, { engine: target.label });
        return (
          <span
            key={target.id}
            title={label}
            aria-label={label}
            role="img"
            className={cx(
              "size-1.5 rounded-full",
              state === "synced" && "bg-accent-500",
              state === "orphan" && "bg-text-error-primary",
              state === "off" && "bg-background-tertiary-hover ring-1 ring-separator-border",
            )}
          />
        );
      })}
      {hasOrphanCopy(skill) ? (
        <span className="text-[10px] text-text-error-primary">
          {t("skills.orphanHint")}
        </span>
      ) : null}
    </span>
  );
}

export type Feedback = { tone: "success" | "error" | "pending"; text: string } | null;

/** Inline status line under a pane header: spinner / check / alert + text. */
export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const Icon =
    feedback.tone === "pending" ? Loader2 : feedback.tone === "success" ? Check : TriangleAlert;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={cx(
        "flex items-center gap-1.5 text-body-2-regular",
        feedback.tone === "error" ? "text-text-error-primary" : "text-text-secondary",
      )}
    >
      <Icon
        className={cx("size-4 shrink-0", feedback.tone === "pending" && "animate-spin")}
        aria-hidden
      />
      {feedback.text}
    </p>
  );
}

/** Rounded neutral chip used for filters and metadata. */
export function Chip({
  selected,
  children,
  onClick,
  title,
}: {
  selected?: boolean;
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  const classes = cx(
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption-1-regular transition-colors",
    onClick &&
      "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
    selected
      ? "bg-background-tertiary-default text-text-primary"
      : "bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-default",
  );
  if (!onClick) {
    return (
      <span className={classes} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={Boolean(selected)}
      className={classes}
    >
      {children}
    </button>
  );
}

