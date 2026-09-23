/**
 * 我的 Skills: the installed list, local import, engine sync from the row or
 * the detail panel, updates and destructive confirmations.
 *
 * A row is a button that opens the detail panel; the engine icons next to it
 * are separate buttons, so opening the panel can never toggle a target by
 * accident and toggling one engine never opens the panel. 纳管 (adopt a local
 * skill) is deliberately not a row action: it lives in the detail panel and in
 * the target checkboxes, so the list keeps one action per row at most.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { ModalShell } from "@/components/dialogs";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { cx } from "@/utils/cx";
import { skillsHubApi } from "./api";
import {
  Chip,
  FeedbackLine,
  SourceBadge,
  TargetEngines,
  type Feedback,
} from "./components";
import { SkillDetailDialog } from "./SkillDetailDialog";
import { SkillImportDialog } from "./SkillImportDialog";
import { useInstalledSkills } from "./useInstalledSkills";
import { useSkillUsage } from "./useSkillUsage";
import type { SkillRow, SkillTargetId } from "./types";
import {
  filterSkills,
  nextTargets,
  summarizeTargetResults,
  usageForSkill,
  visibleEngines,
} from "./utils";

/** The update map is keyed by skill id; local entries (unmanaged) never have
 *  upstream updates. */
type UpdateMap = Record<string, boolean>;

export function InstalledPane({ onBrowse }: { onBrowse: () => void }) {
  const { t } = useTranslation();
  const store = useInstalledSkills(true);
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<SkillTargetId | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<{ skillId: string; targetId: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    | { kind: "uninstall"; skill: SkillRow }
    | { kind: "deleteLocal"; skill: SkillRow }
    | { kind: "overwrite"; skill: SkillRow }
    | null
  >(null);
  const [updates, setUpdates] = useState<UpdateMap>({});
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const refreshAction = useActionFeedback({ spin: true });

  // The selected row is derived from the refreshed list, never a stale copy:
  // a toggle in the row (or in the detail panel) must reach the panel that is
  // already open, and a removed skill closes it without a second state source.
  const selected = useMemo(
    () => store.skills.find((skill) => skill.id === selectedId) ?? null,
    [store.skills, selectedId],
  );
  // Usage is only fetched once a detail panel is open (Claude Code transcripts,
  // cached for 10 minutes server-side) — browsing hundreds of skills stays cheap.
  const usageStore = useSkillUsage(selectedId !== null);

  const engineChips = useMemo(
    () => visibleEngines(store.skills, store.targets),
    [store.skills, store.targets],
  );

  const targetLabel = (targetId: string) =>
    store.targets.find((target) => target.id === targetId)?.label ?? targetId;

  const filtered = useMemo(
    () => filterSkills(store.skills, { query, target: engine }),
    [store.skills, query, engine],
  );

  const updateCount = useMemo(
    () => Object.values(updates).filter(Boolean).length,
    [updates],
  );

  const flash = (next: Feedback, ttlMs = 4000) => {
    setFeedback(next);
    if (ttlMs > 0) {
      window.setTimeout(() => {
        setFeedback((current) => (current === next ? null : current));
      }, ttlMs);
    }
  };

  const reportTargetResults = (results: { target: string; ok: boolean; error: string | null }[] | undefined, name: string) => {
    const summary = summarizeTargetResults(results);
    if (summary.allOk) {
      flash({ tone: "success", text: t("skills.feedback.syncedAll", { name }) });
      return;
    }
    const failed = summary.failed.map((entry) => targetLabel(entry.target)).join(", ");
    flash({ tone: "error", text: t("skills.feedback.syncedPartial", { name, failed }) }, 0);
  };

  const handleRefresh = () => {
    if (refreshAction.feedback === "running") return;
    void refreshAction
      .start(async () => {
        await store.refresh();
        // Update signals ride the same refresh: one round trip for the user.
        const payload = await skillsHubApi.updates(false);
        setUpdates(payload.updates ?? {});
      })
      .catch((error: unknown) => {
        flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
      });
  };

  const runUpdate = async (skill: SkillRow, force: boolean) => {
    if (!skill.repoOwner || !skill.repoName) return;
    try {
      await store.runMutation(skill.id, () =>
        skillsHubApi.install(
          {
            key: skill.key,
            name: skill.name,
            description: skill.description,
            directory: skill.sourceDirectory || skill.directory,
            readmeUrl: skill.readmeUrl,
            repoOwner: skill.repoOwner as string,
            repoName: skill.repoName as string,
            repoBranch: skill.repoBranch ?? "main",
          },
          (skill.targets.length > 0 ? skill.targets : ["claude", "codex"]) as SkillTargetId[],
          force,
        ),
      );
      setUpdates((previous) => ({ ...previous, [skill.id]: false }));
      flash({ tone: "success", text: t("skills.feedback.updated", { name: skill.name }) });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "conflict" && !force) {
        setConfirm({ kind: "overwrite", skill });
        return;
      }
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const runUninstall = async (skill: SkillRow) => {
    setConfirm(null);
    try {
      const result = await store.uninstall(skill.id);
      if (result.trashed && result.restoreId) {
        setRestoreId(result.restoreId);
        flash({ tone: "success", text: t("skills.feedback.uninstalled", { name: skill.name }) }, 0);
      } else {
        setRestoreId(null);
        flash({ tone: "success", text: t("skills.feedback.uninstalled", { name: skill.name }) });
      }
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const runRestore = async () => {
    if (!restoreId) return;
    try {
      await store.restore(restoreId);
      setRestoreId(null);
      flash({ tone: "success", text: t("skills.feedback.restored") });
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const runDeleteLocal = async (skill: SkillRow) => {
    setConfirm(null);
    try {
      const result = await store.deleteLocal(skill.directory, skill.targets);
      reportTargetResults(result.targetResults, skill.name);
      if (selectedId === skill.id) setSelectedId(null);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  /** Sync one engine on/off from the row icon or the detail checkbox: the
   *  message names the engine, because a single-target action must not read
   *  like a bulk result. */
  const onToggleTarget = async (
    skill: SkillRow,
    targetId: SkillTargetId,
    enabled: boolean,
  ) => {
    setBusyTarget({ skillId: skill.id, targetId });
    try {
      const next = nextTargets(skill, targetId, enabled);
      const result = skill.managed
        ? await store.setTargets(skill.id, next)
        : await store.importLocal(skill.directory, next);
      const entry = result.targetResults?.find((item) => item.target === targetId);
      if (entry && !entry.ok) {
        flash(
          {
            tone: "error",
            text: t("skills.feedback.syncFailed", {
              engine: targetLabel(targetId),
              error: entry.error ?? "",
            }),
          },
          0,
        );
        return;
      }
      const vars = { name: skill.name, engine: targetLabel(targetId) };
      // 用户自己的来源副本不会被删除：后端保留它并标 kept，UI 就不能说成
      // “已移除”，否则刷新后图标还在，自相矛盾。
      if (!enabled && entry?.kept) {
        flash({ tone: "success", text: t("skills.feedback.keptLocal", vars) });
        return;
      }
      flash({
        tone: "success",
        text: enabled
          ? t("skills.feedback.syncedOne", vars)
          : t("skills.feedback.unsyncedOne", vars),
      });
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    } finally {
      // 只清自己这一次的繁忙态：另一个引擎的切换可能同时在飞。
      setBusyTarget((current) =>
        current && current.skillId === skill.id && current.targetId === targetId
          ? null
          : current,
      );
    }
  };

  const onImport = async (skill: SkillRow) => {
    try {
      const result = await store.importLocal(skill.directory, skill.targets);
      reportTargetResults(result.targetResults, skill.name);
      setSelectedId(null);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const onImportFromDialog = async (directory: string, targets: SkillTargetId[]) => {
    try {
      const result = await store.importLocal(directory, targets);
      reportTargetResults(result.targetResults, directory);
      setImportOpen(false);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("skills.searchPlaceholder")}
          placeholder={t("skills.searchPlaceholder")}
          value={query}
          onChange={setQuery}
          leadingIcon={Search}
          size="small"
          className="flex-1"
        />
        <Button
          variant="secondary"
          size="small"
          disabled={store.loading || refreshAction.feedback === "running"}
          onClick={handleRefresh}
        >
          <ActionFeedbackIcon icon={RefreshCw} feedback={refreshAction.feedback} spin />
          {t("skills.refresh")}
        </Button>
        <Button
          variant="secondary"
          size="small"
          leadingIcon={Plus}
          disabled={store.loading}
          onClick={() => setImportOpen(true)}
        >
          {t("skills.actions.importLocal")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip selected={engine === ""} onClick={() => setEngine("")}>
          {t("skills.filter.allEngines")}
        </Chip>
        {engineChips.map((target) => (
          <Chip
            key={target.id}
            selected={engine === target.id}
            onClick={() => setEngine(target.id as SkillTargetId)}
            title={target.path}
          >
            <span className="flex items-center gap-1">
              <EngineIcon engine={target.id} size={12} />
              {target.label}
            </span>
          </Chip>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-caption-1-regular text-text-tertiary">
          {t("skills.count", { count: filtered.length, total: store.skills.length })}
        </p>
        {updateCount > 0 ? (
          <p className="text-caption-1-regular text-accent-600">
            {t("skills.updatesAvailable", { count: updateCount })}
          </p>
        ) : null}
      </div>

      <FeedbackLine feedback={feedback} />
      {restoreId ? (
        <Button variant="secondary" size="xs" className="self-start" onClick={() => void runRestore()}>
          {t("skills.feedback.restoreNow")}
        </Button>
      ) : null}

      {store.loading && store.skills.length === 0 ? (
        <CenteredSpinner className="py-10" />
      ) : store.error ? (
        <div className="flex flex-col items-start gap-2 py-6">
          <p role="alert" className="text-body-2-regular text-text-error-primary">
            {store.error}
          </p>
          <Button variant="secondary" size="small" onClick={() => void store.refresh()}>
            {t("common.refresh")}
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState className="flex-col gap-2 py-10 text-center">
          <p className="text-body-2-regular">
            {store.skills.length === 0 ? t("skills.empty.none") : t("skills.empty.filtered")}
          </p>
          {store.skills.length === 0 ? (
            <Button variant="secondary" size="small" onClick={onBrowse}>
              {t("skills.empty.browse")}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <ul className="flex w-full flex-col gap-1">
          {filtered.map((skill) => {
            const pending =
              store.pendingIds.has(skill.id) || store.pendingIds.has(skill.directory);
            const rowUpdate = Boolean(updates[skill.id]);
            return (
              <li key={skill.id}>
                <div
                  className={cx(
                    "flex w-full items-center gap-2 rounded-2lg border border-separator-border px-3 py-2 transition-colors",
                    pending && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(skill.id)}
                    aria-label={t("skills.row.open", { name: skill.name })}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate text-body-regular text-text-primary" title={skill.name}>
                        {skill.name}
                      </span>
                      <SourceBadge skill={skill} />
                    </span>
                    <span className="w-full truncate text-caption-1-regular text-text-secondary">
                      {skill.description || skill.directory}
                    </span>
                  </button>
                  <TargetEngines
                    skill={skill}
                    targets={store.targets}
                    busyTarget={busyTarget?.skillId === skill.id ? busyTarget.targetId : null}
                    disabled={pending}
                    onToggleTarget={(row, targetId, enabled) =>
                      void onToggleTarget(row, targetId, enabled)
                    }
                  />
                  {rowUpdate ? (
                    <Button
                      variant="primary"
                      size="xs"
                      disabled={pending}
                      onClick={() => void runUpdate(skill, false)}
                    >
                      {t("skills.actions.update")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <SkillDetailDialog
          skill={selected}
          targets={store.targets}
          pending={
            store.pendingIds.has(selected.id) || store.pendingIds.has(selected.directory)
          }
          busyTarget={busyTarget?.skillId === selected.id ? busyTarget.targetId : null}
          usage={usageForSkill(usageStore.usage, selected)}
          usageLoading={usageStore.usageLoading}
          usageError={usageStore.usageError}
          hasUpdate={Boolean(updates[selected.id])}
          onClose={() => setSelectedId(null)}
          onToggleTarget={(skill, targetId, enabled) =>
            void onToggleTarget(skill, targetId, enabled)
          }
          onTriggerUpdate={(skill) => void runUpdate(skill, false)}
          onUninstall={(skill) => setConfirm({ kind: "uninstall", skill })}
          onDeleteLocal={(skill) => setConfirm({ kind: "deleteLocal", skill })}
          onImport={(skill) => void onImport(skill)}
        />
      ) : null}

      {importOpen ? (
        <SkillImportDialog
          targets={store.targets}
          busy={[...store.pendingIds].length > 0}
          onClose={() => setImportOpen(false)}
          onImport={(directory, targets) => void onImportFromDialog(directory, targets)}
        />
      ) : null}

      {confirm ? (
        <ModalShell
          onClose={() => setConfirm(null)}
          label={t("skills.confirm.title")}
          className="w-[420px] max-w-[92vw]"
          dialogClassName="flex flex-col gap-3"
        >
          <h3 className="text-title-3-medium text-text-primary">
            {confirm.kind === "uninstall"
              ? t("skills.confirm.uninstallTitle", { name: confirm.skill.name })
              : confirm.kind === "deleteLocal"
                ? t("skills.confirm.deleteTitle", { name: confirm.skill.name })
                : t("skills.confirm.overwriteTitle", { name: confirm.skill.name })}
          </h3>
          <p className="text-body-2-regular text-text-secondary">
            {confirm.kind === "uninstall"
              ? t("skills.confirm.uninstallBody")
              : confirm.kind === "deleteLocal"
                ? t("skills.confirm.deleteBody")
                : t("skills.confirm.overwriteBody")}
          </p>
          {confirm.kind === "deleteLocal" && confirm.skill.targetPaths ? (
            <ul className="flex flex-col gap-1 rounded-2lg bg-background-tertiary-default p-2">
              {Object.values(confirm.skill.targetPaths).map((path) => (
                <li key={path} className="break-all font-mono text-caption-1-regular text-text-secondary">
                  {path}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="small" onClick={() => setConfirm(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={() => {
                if (confirm.kind === "uninstall") void runUninstall(confirm.skill);
                else if (confirm.kind === "deleteLocal") void runDeleteLocal(confirm.skill);
                else {
                  const skill = confirm.skill;
                  setConfirm(null);
                  void runUpdate(skill, true);
                }
              }}
            >
              {confirm.kind === "overwrite"
                ? t("skills.confirm.overwriteConfirm")
                : t("common.confirm")}
            </Button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
