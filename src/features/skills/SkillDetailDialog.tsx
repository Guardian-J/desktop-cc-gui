/**
 * Skill detail: metadata, per-engine target sync, SKILL.md content and the
 * destructive actions. SKILL.md is fetched on open (never with the list), so
 * browsing hundreds of skills stays cheap.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { ModalShell } from "@/components/dialogs";
import { MarkdownPreview } from "@/features/files/MarkdownPreview";
import { openExternal } from "@/lib/platform";
import { skillsHubApi } from "./api";
import { SourceBadge } from "./components";
import type { SkillRow, SkillTargetId, SkillTargetInfo } from "./types";
import { sourceKindOf } from "./utils";

interface SkillContentState {
  path: string;
  markdown: string;
  truncated: boolean;
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-body-2-regular text-text-secondary">{label}</span>
      <span className="min-w-0 text-right text-body-2-regular text-text-primary">{children}</span>
    </div>
  );
}

export function SkillDetailDialog({
  skill,
  targets,
  pending,
  hasUpdate,
  onClose,
  onToggleTarget,
  onTriggerUpdate,
  onUninstall,
  onDeleteLocal,
  onImport,
}: {
  skill: SkillRow;
  targets: SkillTargetInfo[];
  pending: boolean;
  hasUpdate: boolean;
  onClose: () => void;
  onToggleTarget: (skill: SkillRow, next: SkillTargetId[]) => void;
  onTriggerUpdate: (skill: SkillRow) => void;
  onUninstall: (skill: SkillRow) => void;
  onDeleteLocal: (skill: SkillRow) => void;
  onImport: (skill: SkillRow) => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<SkillContentState | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadContent = useCallback(async () => {
    const current = sequence.current + 1;
    sequence.current = current;
    const canCommit = () => mounted.current && sequence.current === current;
    setLoading(true);
    setContentError(null);
    try {
      const payload = await skillsHubApi.content(skill.directory);
      if (!canCommit()) return;
      setContent({
        path: payload.path,
        markdown: payload.markdown,
        truncated: payload.truncated,
      });
    } catch (error) {
      if (!canCommit()) return;
      setContent(null);
      setContentError(error instanceof Error ? error.message : String(error));
    } finally {
      if (canCommit()) setLoading(false);
    }
  }, [skill.directory]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const readonly = skill.readonly === true;
  const kind = sourceKindOf(skill);
  const selected = new Set(skill.targets ?? []);

  const toggleTarget = (targetId: SkillTargetId, next: boolean) => {
    const nextTargets = new Set(selected);
    if (next) nextTargets.add(targetId);
    else nextTargets.delete(targetId);
    onToggleTarget(skill, [...nextTargets]);
  };

  return (
    <ModalShell
      onClose={onClose}
      label={t("skills.detail.title", { name: skill.name })}
      className="flex max-h-[80vh] w-[520px] max-w-[94vw] flex-col"
      dialogClassName="flex min-h-0 flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-title-3-medium text-text-primary" title={skill.name}>
            {skill.name}
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <SourceBadge skill={skill} />
            <span className="truncate text-caption-1-regular text-text-tertiary" title={skill.directory}>
              {skill.directory}
            </span>
          </div>
        </div>
      </div>

      {skill.description ? (
        <p className="text-body-2-regular text-text-secondary">{skill.description}</p>
      ) : null}

      <div className="rounded-2lg border border-separator-border px-3 py-1">
        {skill.repoOwner && skill.repoName ? (
          <PropertyRow label={t("skills.detail.repository")}>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent-600 hover:underline"
              onClick={() =>
                skill.readmeUrl ? openExternal(skill.readmeUrl) : undefined
              }
            >
              {skill.repoOwner}/{skill.repoName}
              <ExternalLink className="size-3.5" aria-hidden />
            </button>
          </PropertyRow>
        ) : null}
        <PropertyRow label={t("skills.detail.directory")}>
          <span className="break-all font-mono text-caption-1-regular">{skill.directory}</span>
        </PropertyRow>
        {skill.targetPaths && Object.keys(skill.targetPaths).length > 0 ? (
          <PropertyRow label={t("skills.detail.paths")}>
            <span className="flex flex-col gap-0.5">
              {Object.entries(skill.targetPaths).map(([key, value]) => (
                <span key={`${key}:${value}`} className="break-all font-mono text-caption-1-regular">
                  {value}
                </span>
              ))}
            </span>
          </PropertyRow>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-body-2-medium text-text-primary">{t("skills.detail.targets")}</p>
        {targets.map((target) => {
          const state = skill.targetStates?.[target.id] ?? "off";
          return (
            <div key={target.id} className="flex items-center justify-between gap-2">
              <Checkbox
                size="sm"
                isSelected={state === "synced"}
                isDisabled={readonly || pending}
                onChange={(next) => toggleTarget(target.id as SkillTargetId, next)}
              >
                {target.label}
              </Checkbox>
              <span className="text-caption-1-regular text-text-tertiary">
                {t(`skills.targetState.${state}`)}
              </span>
            </div>
          );
        })}
        {readonly ? (
          <p className="text-caption-1-regular text-text-tertiary">
            {t(`skills.readonly.${kind}`)}
          </p>
        ) : null}
        {!skill.managed && !readonly ? (
          <p className="text-caption-1-regular text-text-tertiary">
            {t("skills.detail.promoteHint")}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-2lg border border-separator-border p-3">
        {loading ? (
          <p className="flex items-center gap-2 text-body-2-regular text-text-secondary">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("skills.detail.contentLoading")}
          </p>
        ) : contentError ? (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-body-2-regular text-text-error-primary">
              {contentError}
            </p>
            <Button variant="secondary" size="xs" onClick={() => void loadContent()}>
              {t("common.refresh")}
            </Button>
          </div>
        ) : content ? (
          <div className="text-body-2-regular">
            <MarkdownPreview path={content.path} draft={content.markdown} />
            {content.truncated ? (
              <p className="mt-2 text-caption-1-regular text-text-tertiary">
                {t("skills.detail.contentTruncated")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {skill.managed ? (
            <Button
              variant="secondary"
              size="small"
              disabled={pending}
              onClick={() => onUninstall(skill)}
            >
              {t("skills.actions.uninstall")}
            </Button>
          ) : null}
          {!skill.managed && !readonly ? (
            <>
              <Button
                variant="secondary"
                size="small"
                disabled={pending}
                onClick={() => onImport(skill)}
              >
                {t("skills.actions.import")}
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={pending}
                onClick={() => onDeleteLocal(skill)}
              >
                {t("skills.actions.deleteLocal")}
              </Button>
            </>
          ) : null}
        </div>
        <div className="flex gap-2">
          {hasUpdate ? (
            <Button
              variant="primary"
              size="small"
              disabled={pending}
              onClick={() => onTriggerUpdate(skill)}
            >
              {t("skills.actions.update")}
            </Button>
          ) : null}
          <Button variant="secondary" size="small" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
