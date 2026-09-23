/**
 * 我的 Skills: the installed list, local import, target sync via the detail
 * dialog, updates and destructive confirmations.
 *
 * Rows are plain buttons; all switches live in the detail dialog so a click
 * on a row can never toggle a target by accident.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { ModalShell } from "@/components/dialogs";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { cx } from "@/utils/cx";
import { skillsHubApi } from "./api";
import { Chip, FeedbackLine, SourceBadge, TargetDots, type Feedback } from "./components";
import { SkillDetailDialog } from "./SkillDetailDialog";
import { SkillImportDialog } from "./SkillImportDialog";
import { useInstalledSkills } from "./useInstalledSkills";
import type { SkillRow, SkillSourceKind, SkillTargetId } from "./types";
import { filterSkills, sourceKindOf, summarizeTargetResults } from "./utils";

const SOURCE_FILTERS: (SkillSourceKind | "")[] = [
  "",
  "managed",
  "local",
  "builtin",
  "system",
  "plugin",
];

/** The update map is keyed by skill id; local entries (unmanaged) never have
 *  upstream updates. */
type UpdateMap = Record<string, boolean>;

export function InstalledPane({ onBrowse }: { onBrowse: () => void }) {
  const { t } = useTranslation();
  const store = useInstalledSkills(true);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SkillSourceKind | "">("");
  const [engine, setEngine] = useState<SkillTargetId | "">("");
  const [selected, setSelected] = useState<SkillRow | null>(null);
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

  const filtered = useMemo(
    () => filterSkills(store.skills, { query, source, target: engine }),
    [store.skills, query, source, engine],
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
    const failed = summary.failed.map((entry) => entry.target).join(", ");
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
      if (selected?.id === skill.id) setSelected(null);
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
      if (selected?.id === skill.id) setSelected(null);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const onToggleTarget = async (skill: SkillRow, next: SkillTargetId[]) => {
    try {
      const result = skill.managed
        ? await store.setTargets(skill.id, next)
        : await store.importLocal(skill.directory, next);
      reportTargetResults(result.targetResults, skill.name);
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const onImport = async (skill: SkillRow) => {
    try {
      const result = await store.importLocal(skill.directory, skill.targets);
      reportTargetResults(result.targetResults, skill.name);
      setSelected(null);
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
        {SOURCE_FILTERS.map((kind) => (
          <Chip key={kind || "all"} selected={source === kind} onClick={() => setSource(kind)}>
            {kind ? t(`skills.source.${kind}`) : t("skills.filter.allSources")}
          </Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-separator-border" aria-hidden />
        <Chip selected={engine === ""} onClick={() => setEngine("")}>
          {t("skills.filter.allEngines")}
        </Chip>
        {store.targets.map((target) => (
          <Chip
            key={target.id}
            selected={engine === target.id}
            onClick={() => setEngine(target.id as SkillTargetId)}
          >
            {target.label}
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
                    onClick={() => setSelected(skill)}
                    aria-label={t("skills.row.open", { name: skill.name })}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate text-body-regular text-text-primary" title={skill.name}>
                        {skill.name}
                      </span>
                      <SourceBadge skill={skill} />
                      <TargetDots skill={skill} targets={store.targets} />
                    </span>
                    <span className="w-full truncate text-caption-1-regular text-text-secondary">
                      {skill.description || skill.directory}
                    </span>
                  </button>
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
                  {!skill.managed && sourceKindOf(skill) === "local" ? (
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={pending}
                      onClick={() => void onImport(skill)}
                    >
                      {t("skills.actions.import")}
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
          hasUpdate={Boolean(updates[selected.id])}
          onClose={() => setSelected(null)}
          onToggleTarget={(skill, next) => void onToggleTarget(skill, next)}
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
