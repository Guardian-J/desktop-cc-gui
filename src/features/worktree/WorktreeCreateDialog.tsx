import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Search from "lucide-react/dist/esm/icons/search";
import { ModalShell } from "@/components/dialogs";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/chips/chip";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import {
  Dropdown,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import {
  ipc,
  type BranchInfo,
  type PrPreview,
  type Workspace,
  type WorktreeCreateArgs,
} from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { useGitStore } from "@/features/git/store";
import { useWorktreeStore } from "./store";
import {
  defaultWorktreePath,
  isPlausibleBranchName,
  parsePrInput,
  suggestPrBranch,
} from "./pr-input";

type SourceTab = "pr" | "new" | "existing";

/** Searchable branch picker mirroring the changes panel's branch dropdown
 *  (trigger + sticky search + scrollable rows). `blocked` names render as
 *  disabled plain rows with the reason — not as fake buttons. */
function BranchCombobox({
  branches,
  value,
  onSelect,
  placeholder,
  blocked,
  blockedReason,
  ariaLabel,
  remoteLabel,
}: {
  branches: BranchInfo[];
  value: string | null;
  onSelect: (name: string) => void;
  placeholder: string;
  blocked?: Set<string>;
  blockedReason?: string;
  ariaLabel: string;
  /** Trailing tag on remote-tracking rows (t("git.remoteBranch")). */
  remoteLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [branches, query]);
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        className={cx(
          "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border border-border-button-default",
          "px-2 text-body-medium text-text-primary shadow-xs",
          "hover:bg-background-secondary-hover",
        )}
      >
        <GitBranch aria-hidden className="size-4 shrink-0 text-foreground-icon-secondary" />
        <span className={cx("truncate", !value && "text-text-placeholder")}>
          {value ?? placeholder}
        </span>
        <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 text-foreground-icon-tertiary" />
      </DropdownTrigger>
      <DropdownPopover aria-label={ariaLabel} placement="bottom start" className="max-h-80!">
        <div className="sticky -top-2.5 z-10 -mx-2.5 -mt-2.5 bg-background-primary-default px-2.5 pt-2.5 pb-1">
          <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border-button-default px-2">
            <Search aria-hidden className="size-4 shrink-0 text-foreground-icon-secondary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
            />
          </div>
        </div>
        {filtered.map((b) => {
          const isBlocked = blocked?.has(b.name) ?? false;
          if (isBlocked) {
            return (
              <div
                key={`${b.isRemote ? "r" : "l"}:${b.name}`}
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-lg p-2 text-body-medium text-text-disabled"
                title={blockedReason}
              >
                <span className="truncate">{b.name}</span>
                <span className="ml-auto shrink-0 text-caption-1-regular text-text-tertiary">
                  {blockedReason}
                </span>
              </div>
            );
          }
          return (
            <button
              key={`${b.isRemote ? "r" : "l"}:${b.name}`}
              type="button"
              onClick={() => {
                onSelect(b.name);
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-body-medium text-text-primary outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
            >
              <span className="truncate">{b.name}</span>
              {b.isRemote && (
                <span className="ml-auto shrink-0 text-caption-1-regular text-text-tertiary">
                  {remoteLabel}
                </span>
              )}
            </button>
          );
        })}
      </DropdownPopover>
    </Dropdown>
  );
}

/** Three-source worktree creation (PR / new branch / existing branch). The
 *  submit hands off to the background pipeline immediately — progress lives
 *  in the sidebar's pending row, so the dialog closes on submit. */
export function WorktreeCreateDialog({
  parent,
  onClose,
}: {
  parent: Workspace;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const prefs = useWorktreeStore((s) => s.prefs);
  const branches = useGitStore((s) => s.branchesByWorkspace[parent.path]);

  const [tab, setTab] = useState<SourceTab>("pr");
  const [occupied, setOccupied] = useState<Set<string>>(new Set());

  // PR tab
  const [prInput, setPrInput] = useState("");
  const [preview, setPreview] = useState<PrPreview | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<"notGitHub" | "invalidPrInput" | null>(null);
  const resolveSeq = useRef(0);
  const lastResolveKey = useRef("");

  // New-branch tab
  const [branchName, setBranchName] = useState("");
  const [base, setBase] = useState<string | null>(null);

  // Existing-branch tab
  const [existing, setExisting] = useState<string | null>(null);

  // Shared
  const [location, setLocation] = useState(prefs.location ?? "");
  const [locationTouched, setLocationTouched] = useState(prefs.location != null);
  const [openSessionAfter, setOpenSessionAfter] = useState(prefs.openSessionAfter);
  const [submitting, setSubmitting] = useState(false);

  const prNumber = tab === "pr" ? parsePrInput(prInput) : null;
  const effectiveBranch =
    tab === "pr"
      ? prNumber
        ? suggestPrBranch(prNumber, preview?.title)
        : ""
      : tab === "new"
        ? branchName.trim()
        : (existing ?? "");

  // Branch list + occupancy (existing-branch flow blocks checked-out names).
  useEffect(() => {
    void useGitStore.getState().loadBranches(parent.path);
    void ipc
      .gitWorktreeList(parent.path)
      .then((list) => {
        setOccupied(
          new Set(list.map((w) => w.branch).filter((b): b is string => b != null)),
        );
      })
      .catch(() => undefined);
  }, [parent.path]);

  // Default base: prefer origin/main-ish, then any remote, then first.
  useEffect(() => {
    if (base || !branches?.length) return;
    const names = branches.map((b) => b.name);
    const preferred = ["origin/main", "origin/master", "main", "master"].find((n) =>
      names.includes(n),
    );
    setBase(preferred ?? branches.find((b) => b.isRemote)?.name ?? branches[0].name);
  }, [branches, base]);

  // Location follows the branch name until the user edits it manually.
  useEffect(() => {
    if (locationTouched) return;
    setLocation(effectiveBranch ? defaultWorktreePath(parent.path, effectiveBranch) : "");
  }, [effectiveBranch, locationTouched, parent.path]);

  // PR preview: debounced resolve. A second pass re-checks conflicts once
  // the title arrives (branch name gains the slug); the key guard stops the
  // loop when the suggestion stabilizes.
  useEffect(() => {
    if (tab !== "pr") return;
    if (!prNumber) {
      setPreview(null);
      setResolveError(null);
      setResolving(false);
      lastResolveKey.current = "";
      return;
    }
    const seq = ++resolveSeq.current;
    setResolving(true);
    setResolveError(null);
    const timer = setTimeout(() => {
      const suggested = suggestPrBranch(prNumber, preview?.title);
      const dir = locationTouched
        ? location.trim()
        : defaultWorktreePath(parent.path, suggested);
      const key = `${prNumber}|${suggested}|${dir}`;
      if (lastResolveKey.current === key) {
        setResolving(false);
        return;
      }
      lastResolveKey.current = key;
      void ipc
        .gitResolvePr(parent.path, prInput, suggested, dir)
        .then((p) => {
          if (resolveSeq.current !== seq) return;
          setPreview(p);
          setResolving(false);
        })
        .catch((err) => {
          if (resolveSeq.current !== seq) return;
          setPreview(null);
          setResolving(false);
          setResolveError(String(err).includes("not_github") ? "notGitHub" : "invalidPrInput");
        });
    }, 400);
    return () => clearTimeout(timer);
    // preview?.title 参与派生分支名，必须跟踪；location 变化影响 dir 冲突检查。
  }, [prInput, prNumber, preview?.title, location, locationTouched, parent.path, tab]);

  const localBranchNames = useMemo(
    () => new Set((branches ?? []).filter((b) => !b.isRemote).map((b) => b.name)),
    [branches],
  );

  const newBranchInvalid =
    tab === "new" && branchName.trim() !== "" && !isPlausibleBranchName(branchName.trim());
  const newBranchClash = tab === "new" && localBranchNames.has(branchName.trim());

  const canSubmit =
    !submitting &&
    effectiveBranch !== "" &&
    location.trim() !== "" &&
    (tab === "pr"
      ? prNumber != null &&
        preview != null &&
        !resolving &&
        !preview.branchConflict &&
        !preview.dirConflict
      : tab === "new"
        ? !newBranchInvalid && !newBranchClash && base != null
        : existing != null && !occupied.has(existing));

  const submit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const args: WorktreeCreateArgs = {
      repoPath: parent.path,
      parentWorkspaceId: parent.id,
      branch: effectiveBranch,
      worktreePath: location.trim(),
      baseRef: tab === "new" ? base : null,
      prNumber: tab === "pr" ? prNumber : null,
      prTitle: tab === "pr" ? (preview?.title ?? null) : null,
      prUrl:
        tab === "pr" && prNumber
          ? prInput.includes("github.com")
            ? prInput.trim()
            : `https://github.com/${preview?.repo}/pull/${prNumber}`
          : null,
      existingBranch: tab === "existing",
    };
    const store = useWorktreeStore.getState();
    store.setPrefs({
      location: locationTouched ? location.trim() : null,
      openSessionAfter,
    });
    store.start(args, { parentPath: parent.path, openSessionAfter });
    onClose();
  };

  return (
    <ModalShell label={t("worktree.createTitle")} onClose={onClose} className="w-[28rem]">
      <div
        className="flex flex-col gap-3"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div>
          <h3 className="text-title-3-semibold text-text-primary">{t("worktree.createTitle")}</h3>
          <div className="mt-0.5 text-caption-1-regular text-text-tertiary">
            {t("worktree.createBasedOn", { name: parent.name })}
          </div>
        </div>

        <div className="flex gap-1.5">
          <Chip selected={tab === "pr"} onClick={() => setTab("pr")}>
            {t("worktree.tabFromPr")}
          </Chip>
          <Chip selected={tab === "new"} onClick={() => setTab("new")}>
            {t("worktree.tabNewBranch")}
          </Chip>
          <Chip selected={tab === "existing"} onClick={() => setTab("existing")}>
            {t("worktree.tabExistingBranch")}
          </Chip>
        </div>

        {tab === "pr" && (
          <>
            <Input
              autoFocus
              size="small"
              label={t("worktree.prInputLabel")}
              placeholder={t("worktree.prInputPlaceholder")}
              hint={t("worktree.prInputHint")}
              value={prInput}
              onChange={(v) => setPrInput(v)}
              isInvalid={prInput.trim() !== "" && prNumber == null}
            />
            {prInput.trim() !== "" && prNumber == null && (
              <div role="alert" className="text-caption-1-regular text-text-error-primary">
                {t("worktree.invalidPrInput")}
              </div>
            )}
            {resolving && (
              <div className="flex items-center gap-1.5 text-caption-1-regular text-text-tertiary">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                {t("worktree.resolving")}
              </div>
            )}
            {resolveError && (
              <div role="alert" className="text-caption-1-regular text-text-error-primary">
                {t(`worktree.${resolveError}`)}
              </div>
            )}
            {preview && (
              <div className="flex flex-col gap-1 rounded-lg border border-border-button-default bg-background-secondary-default p-2.5">
                {preview.degraded ? (
                  <div className="text-body-medium text-text-secondary">
                    {t("worktree.prPreviewDegraded", {
                      number: preview.number,
                      repo: preview.repo,
                    })}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-body-medium text-text-primary">
                      <span className="min-w-0 flex-1 truncate">{preview.title}</span>
                      {preview.state === "MERGED" && (
                        <span className="shrink-0 rounded-full bg-status-purple-background px-1.5 py-0.5 text-caption-1-regular text-status-purple-text">
                          {t("worktree.prStateMerged")}
                        </span>
                      )}
                      {preview.state === "CLOSED" && (
                        <span className="shrink-0 rounded-full bg-status-rose-background px-1.5 py-0.5 text-caption-1-regular text-status-rose-text">
                          {t("worktree.prStateClosed")}
                        </span>
                      )}
                    </div>
                    <div className="text-caption-1-regular text-text-tertiary">
                      {[
                        preview.author &&
                          t("worktree.prPreviewAuthor", { author: preview.author, base: base ?? "main" }),
                        typeof preview.additions === "number" && `+${preview.additions} −${preview.deletions ?? 0}`,
                        t("worktree.prPreviewBranch", { branch: effectiveBranch }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </>
                )}
                {preview.branchConflict && (
                  <div role="alert" className="text-caption-1-regular text-text-error-primary">
                    {t("worktree.branchConflict", { branch: effectiveBranch })}
                  </div>
                )}
                {preview.dirConflict && (
                  <div role="alert" className="text-caption-1-regular text-text-error-primary">
                    {t("worktree.dirConflict")}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === "new" && (
          <>
            <Input
              autoFocus
              size="small"
              label={t("worktree.branchLabel")}
              placeholder={t("worktree.branchPlaceholder")}
              value={branchName}
              onChange={(v) => setBranchName(v)}
              isInvalid={newBranchInvalid || newBranchClash}
              hint={
                newBranchInvalid
                  ? t("worktree.invalidBranchName")
                  : newBranchClash
                    ? t("worktree.branchConflict", { branch: branchName.trim() })
                    : undefined
              }
            />
            <div className="flex flex-col gap-1">
              <span className="text-caption-1-medium text-text-secondary">
                {t("worktree.baseLabel")}
              </span>
              <BranchCombobox
                branches={branches ?? []}
                value={base}
                onSelect={setBase}
                placeholder={t("git.searchBranches")}
                ariaLabel={t("worktree.baseLabel")}
                remoteLabel={t("git.remoteBranch")}
              />
              <span className="text-caption-1-regular text-text-tertiary">
                {t("worktree.baseHint")}
              </span>
            </div>
          </>
        )}

        {tab === "existing" && (
          <div className="flex flex-col gap-1">
            <span className="text-caption-1-medium text-text-secondary">
              {t("worktree.existingBranchLabel")}
            </span>
            <BranchCombobox
              branches={branches ?? []}
              value={existing}
              onSelect={setExisting}
              placeholder={t("worktree.existingBranchPlaceholder")}
              blocked={occupied}
              blockedReason={t("worktree.existingBranchOccupied")}
              ariaLabel={t("worktree.existingBranchLabel")}
              remoteLabel={t("git.remoteBranch")}
            />
          </div>
        )}

        <Input
          size="small"
          label={t("worktree.locationLabel")}
          hint={t("worktree.locationHint")}
          value={location}
          onChange={(v) => {
            setLocation(v);
            setLocationTouched(true);
          }}
        />

        <Switch
          size="sm"
          isSelected={openSessionAfter}
          onChange={(v) => setOpenSessionAfter(v)}
        >
          {t("worktree.openSessionAfter")}
        </Switch>

        <div className="mt-1 flex justify-end gap-2 border-t border-separator-border pt-3">
          <Button variant="secondary" size="small" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="small" disabled={!canSubmit} onClick={submit}>
            {t("worktree.createSubmit")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
