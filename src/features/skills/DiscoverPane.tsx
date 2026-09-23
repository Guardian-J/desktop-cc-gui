/**
 * 发现: repo discovery (explicit scan), skills.sh search, popular list and
 * repo management. Online calls only happen from user actions on this pane.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Download from "lucide-react/dist/esm/icons/download";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { ModalShell } from "@/components/dialogs";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { FeedbackLine, type Feedback } from "./components";
import { useSkillDiscovery } from "./useSkillDiscovery";
import type { DiscoveredSkill } from "./types";

type BrowseMode = "popular" | "repos";

function DiscoverRow({
  skill,
  busy,
  installed,
  onInstall,
}: {
  skill: DiscoveredSkill;
  busy: boolean;
  installed: boolean;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2 rounded-2lg border border-separator-border px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-regular text-text-primary" title={skill.name}>
          {skill.name}
        </span>
        <span className="truncate text-caption-1-regular text-text-secondary">
          {skill.description || `${skill.repoOwner}/${skill.repoName}`}
        </span>
        <span className="truncate text-caption-1-regular text-text-tertiary">
          {skill.repoOwner}/{skill.repoName}
          {typeof skill.installs === "number" ? ` · ${t("skills.discover.installs", { count: skill.installs })}` : ""}
        </span>
      </div>
      <Button
        variant="secondary"
        size="xs"
        disabled={busy || installed}
        onClick={onInstall}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        {installed ? t("skills.discover.installed") : t("skills.discover.install")}
      </Button>
    </li>
  );
}

export function DiscoverPane() {
  const { t } = useTranslation();
  const discovery = useSkillDiscovery(true);
  const [mode, setMode] = useState<BrowseMode>("popular");
  /** Keys installed from this pane (session-local): the row flips to 已安装
   *  instead of inviting a second install. A full list refresh happens in
   *  the 我的 Skills tab. */
  const [installedKeys, setInstalledKeys] = useState<ReadonlySet<string>>(new Set());
  const [reposOpen, setReposOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const repoRefresh = useActionFeedback({ spin: true });
  const discoverRefresh = useActionFeedback({ spin: true });

  const flash = (next: Feedback, ttlMs = 4000) => {
    setFeedback(next);
    if (ttlMs > 0) {
      window.setTimeout(() => {
        setFeedback((current) => (current === next ? null : current));
      }, ttlMs);
    }
  };

  const install = async (skill: DiscoveredSkill) => {
    try {
      await discovery.install(skill, ["claude", "codex"]);
      setInstalledKeys((previous) => new Set(previous).add(skill.key));
      flash({ tone: "success", text: t("skills.feedback.installed", { name: skill.name }) });
    } catch (error) {
      flash({ tone: "error", text: error instanceof Error ? error.message : String(error) }, 0);
    }
  };

  const listed = discovery.searchResults ?? discovery.discover;
  const isSearch = discovery.searchResults !== null;
  const busy = discovery.searchLoading || discovery.discoverLoading;
  const error = isSearch ? discovery.searchError : discovery.discoverError;

  const runSearch = () => {
    const trimmed = discovery.query.trim();
    if (trimmed.length < 2) {
      flash({ tone: "error", text: t("skills.discover.searchHint") });
      return;
    }
    void discovery.runSearch(trimmed);
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("skills.discover.searchPlaceholder")}
          placeholder={t("skills.discover.searchPlaceholder")}
          value={discovery.query}
          onChange={discovery.setQuery}
          onKeyDown={(event) => {
            if (event.key === "Enter") runSearch();
          }}
          leadingIcon={Search}
          size="small"
          className="flex-1"
        />
        <Button variant="secondary" size="small" disabled={busy} onClick={runSearch}>
          {t("skills.discover.search")}
        </Button>
        <Button
          variant="secondary"
          size="small"
          disabled={busy}
          onClick={() => {
            if (repoRefresh.feedback === "running") return;
            void repoRefresh
              .start(() =>
                isSearch
                  ? discovery.runSearch(discovery.query.trim())
                  : mode === "popular"
                    ? discovery.loadPopular(true)
                    : discovery.loadDiscover(true),
              )
              .catch((err: unknown) =>
                flash({ tone: "error", text: err instanceof Error ? err.message : String(err) }, 0),
              );
          }}
        >
          <ActionFeedbackIcon icon={RefreshCw} feedback={repoRefresh.feedback} spin />
          {t("common.refresh")}
        </Button>
      </div>

      {!isSearch ? (
        <div className="flex items-center gap-1.5">
          <Button
            variant={mode === "popular" ? "primary" : "secondary"}
            size="xs"
            onClick={() => setMode("popular")}
          >
            {t("skills.discover.popular")}
          </Button>
          <Button
            variant={mode === "repos" ? "primary" : "secondary"}
            size="xs"
            onClick={() => setMode("repos")}
          >
            {t("skills.discover.repos")}
          </Button>
          <span className="flex-1" />
          <Button variant="secondary" size="xs" onClick={() => setReposOpen(true)}>
            {t("skills.discover.manageRepos")}
          </Button>
          {mode === "repos" ? (
            <Button
              variant="secondary"
              size="xs"
              disabled={discovery.discoverLoading}
              onClick={() => {
                if (discoverRefresh.feedback === "running") return;
                void discoverRefresh
                  .start(() => discovery.loadDiscover(true))
                  .catch((err: unknown) =>
                    flash({ tone: "error", text: err instanceof Error ? err.message : String(err) }, 0),
                  );
              }}
            >
              <ActionFeedbackIcon icon={RefreshCw} feedback={discoverRefresh.feedback} spin />
              {t("skills.discover.scan")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-caption-1-regular text-text-tertiary">
            {t("skills.discover.resultCount", { count: discovery.totalCount })}
          </p>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              discovery.setQuery("");
              void discovery.loadPopular(false);
            }}
          >
            {t("skills.discover.clearSearch")}
          </Button>
        </div>
      )}

      {isSearch ? null : (
        <p className="text-caption-1-regular text-text-tertiary">
          {mode === "popular"
            ? t("skills.discover.popularHint")
            : t("skills.discover.reposHint", { count: discovery.repos.length })}
          {!isSearch && discovery.discoverCached ? ` · ${t("skills.discover.cached")}` : ""}
        </p>
      )}

      <FeedbackLine feedback={feedback} />
      {error ? (
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {error}
        </p>
      ) : null}

      {busy && listed.length === 0 ? (
        <CenteredSpinner className="py-10" />
      ) : listed.length === 0 ? (
        <EmptyState className="py-10">
          <p className="text-body-2-regular">
            {isSearch ? t("skills.discover.noResults") : t("skills.discover.none")}
          </p>
        </EmptyState>
      ) : (
        <ul className="flex w-full flex-col gap-1">
          {listed.map((skill) => (
            <DiscoverRow
              key={skill.key}
              skill={skill}
              busy={discovery.installingKey === skill.key}
              installed={installedKeys.has(skill.key)}
              onInstall={() => void install(skill)}
            />
          ))}
        </ul>
      )}

      {reposOpen ? (
        <RepoDialog
          repos={discovery.repos}
          loading={discovery.reposLoading}
          onClose={() => setReposOpen(false)}
          onAdd={async (repo) => {
            await discovery.addRepo(repo);
          }}
          onRemove={async (owner, name) => {
            await discovery.removeRepo(owner, name);
          }}
        />
      ) : null}
    </div>
  );
}

function RepoDialog({
  repos,
  loading,
  onClose,
  onAdd,
  onRemove,
}: {
  repos: { owner: string; name: string; branch: string; enabled: boolean }[];
  loading: boolean;
  onClose: () => void;
  onAdd: (repo: { owner: string; name: string; branch: string }) => Promise<void>;
  onRemove: (owner: string, name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [owner, setOwner] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAdd({ owner: owner.trim(), name: name.trim(), branch: branch.trim() || "main" });
      setOwner("");
      setName("");
      setBranch("main");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      label={t("skills.repos.title")}
      className="w-[460px] max-w-[94vw]"
      dialogClassName="flex flex-col gap-3"
    >
      <h3 className="text-title-3-medium text-text-primary">{t("skills.repos.title")}</h3>
      <p className="text-body-2-regular text-text-secondary">{t("skills.repos.desc")}</p>
      {loading ? (
        <CenteredSpinner className="py-4" />
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {repos.map((repo) => (
            <li
              key={`${repo.owner}/${repo.name}`}
              className="flex items-center justify-between gap-2 rounded-2lg border border-separator-border px-2 py-1.5"
            >
              <span className="truncate text-body-2-regular text-text-primary">
                {repo.owner}/{repo.name}
                <span className="ml-1 text-text-tertiary">@{repo.branch}</span>
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => void onRemove(repo.owner, repo.name)}
              >
                {t("common.delete")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <Input
          aria-label={t("skills.repos.owner")}
          label={t("skills.repos.owner")}
          value={owner}
          onChange={setOwner}
          size="small"
          className="flex-1"
        />
        <Input
          aria-label={t("skills.repos.name")}
          label={t("skills.repos.name")}
          value={name}
          onChange={setName}
          size="small"
          className="flex-1"
        />
        <Input
          aria-label={t("skills.repos.branch")}
          label={t("skills.repos.branch")}
          value={branch}
          onChange={setBranch}
          size="small"
          className="w-24"
        />
      </div>
      {error ? (
        <p role="alert" className="text-caption-1-regular text-text-error-primary">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button
          variant="primary"
          size="small"
          disabled={busy || !owner.trim() || !name.trim()}
          onClick={() => void add()}
        >
          <Settings2 className="size-4" aria-hidden />
          {t("skills.repos.add")}
        </Button>
      </div>
    </ModalShell>
  );
}
