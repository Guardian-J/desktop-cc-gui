import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Download from "lucide-react/dist/esm/icons/download";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import SquareArrowOutUpRight from "lucide-react/dist/esm/icons/square-arrow-out-up-right";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { CenteredSpinner } from "@/components/base/empty-state";
import { isWeb, openExternal } from "@/lib/platform";
import { ipc, type MarketPlugin, type PluginInfo } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { categorizePlugin } from "./catalog";
import { PluginAvatar } from "./PluginAvatar";
import { PluginReadme } from "./PluginReadme";
import { PluginScreenshotCarousel } from "./PluginScreenshotCarousel";
import { describePermission } from "./permissions";
import { usePluginSettingsKey } from "./use-plugin-settings-key";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";

const ACTION_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded-lg bg-background-secondary-default whitespace-nowrap px-3 py-1.5 text-body-medium text-text-primary transition-colors hover:bg-background-secondary-hover disabled:cursor-not-allowed disabled:opacity-60";

const DANGER_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded-lg bg-background-secondary-default whitespace-nowrap px-3 py-1.5 text-body-medium text-text-error-primary transition-colors hover:bg-background-secondary-hover disabled:cursor-not-allowed disabled:opacity-60";

const LINK_BUTTON =
  "flex cursor-pointer items-center gap-1 text-body-2-regular text-text-brand-secondary hover:underline";

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-28 shrink-0 text-body-2-regular text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 text-body-2-regular text-text-primary">{children}</span>
    </div>
  );
}

function ExternalLink({ label, url }: { label: string; url: string }) {
  return (
    <button type="button" onClick={() => openExternal(url)} className={LINK_BUTTON}>
      {label}
      <SquareArrowOutUpRight className="size-3.5" aria-hidden />
    </button>
  );
}

type ReadmeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; markdown: string }
  | { status: "error" };

/** Long-form intro lives on the repo, so it is fetched per detail open (the
 *  backend caches for an hour and answers instantly after the first hit). */
function useMarketReadme(entry?: MarketPlugin): ReadmeState {
  const [state, setState] = useState<ReadmeState>({ status: "idle" });
  const id = entry?.id;
  useEffect(() => {
    if (!id) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    ipc
      .pluginFetchMarketReadme(id)
      .then((markdown) => {
        if (!cancelled) setState({ status: "ready", markdown });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return state;
}

/**
 * Full-page plugin detail (replaces the old modal): opens from a market or
 * installed row and takes over the hub surface with its own back header.
 * Unifies the index entry and the installed record — an install that
 * finishes while the page is open flips it to the installed state without
 * a reopen, exactly like the modal it replaced.
 */
export function PluginDetailPage({
  id,
  entry,
  installed,
  onClose,
}: {
  id: string;
  entry?: MarketPlugin;
  installed?: PluginInfo;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const install = useMarketplaceStore((s) => s.install);
  const installing = useMarketplaceStore((s) => s.installing);
  const update = useMarketplaceStore((s) => s.updates.find((u) => u.id === id));
  const uninstall = usePluginsStore((s) => s.uninstall);
  const settingsKey = usePluginSettingsKey(id);
  const readme = useMarketReadme(entry);

  const name = entry?.name ?? installed?.name ?? id;
  const description = installed?.description || entry?.description || "";
  const author = entry?.author || installed?.author || "";
  const version = installed?.version || entry?.version || "";
  const tier = installed?.tier ?? entry?.tier;
  const repo = entry?.repo;
  // The installed record is the running truth; fall back to the indexed
  // manifest so a not-yet-installed plugin still lists its grants.
  const permissions = installed?.permissions.length
    ? installed.permissions
    : (entry?.permissions ?? []);
  const downloads = entry?.downloads ?? null;
  const minAppVersion = entry?.minAppVersion ?? installed?.minAppVersion ?? null;
  const sdkVersion = entry?.sdkVersion ?? null;
  const screenshots = entry?.screenshots ?? [];
  const category = entry ? categorizePlugin(entry) : null;

  const openSettings = () => {
    if (!settingsKey) return;
    onClose();
    window.location.hash = `#/settings?page=${encodeURIComponent(settingsKey)}`;
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-primary-default">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-separator-border px-4">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("plugins.hub.backToList")}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("plugins.hub.backToList")}
        </button>
        <span className="min-w-0 truncate text-body-medium text-text-primary">{name}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {installed && settingsKey && (
            <button type="button" onClick={openSettings} className={ACTION_BUTTON}>
              <Settings2 className="size-4" aria-hidden />
              {t("plugins.hub.openSettings")}
            </button>
          )}
          {entry && update && (
            <button
              type="button"
              disabled={!!installing || isWeb}
              title={isWeb ? t("plugins.market.desktopOnly") : undefined}
              onClick={() => void install(id)}
              className={ACTION_BUTTON}
            >
              <Download className="size-4" aria-hidden />
              {t("plugins.hub.updateTo", { version: update.latestVersion })}
            </button>
          )}
          {entry && !update && installed && (
            <span className={cx(BADGE, "px-3 py-1.5 text-text-tertiary")}>
              {t("plugins.hub.installed")}
            </span>
          )}
          {entry && !update && !installed && (
            <button
              type="button"
              disabled={!!installing || isWeb}
              title={isWeb ? t("plugins.market.desktopOnly") : undefined}
              onClick={() => void install(id)}
              className={ACTION_BUTTON}
            >
              {installing?.id === id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              {t("plugins.hub.install")}
            </button>
          )}
          {installed && installed.source !== "builtin" && (
            <button
              type="button"
              disabled={isWeb}
              title={isWeb ? t("plugins.market.desktopOnly") : undefined}
              onClick={() => {
                onClose();
                void uninstall(installed, false);
              }}
              className={cx(DANGER_BUTTON)}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("plugins.uninstall")}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-8 px-6 py-8">
          <header className="flex items-start gap-4">
            <PluginAvatar id={id} name={name} size={64} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h2 className="text-title-2-medium text-text-primary">{name}</h2>
              {description && (
                <p className="max-w-2xl text-body-regular text-text-secondary">
                  {description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {version && <span className={BADGE}>v{version}</span>}
                {tier && (
                  <span className={BADGE}>
                    {t(
                      tier === "declarative"
                        ? "plugins.hub.tierDeclarative"
                        : "plugins.hub.tierJs",
                    )}
                  </span>
                )}
                {installed && (
                  <span className={BADGE}>
                    {t(`plugins.source.${installed.source}`, installed.source)}
                  </span>
                )}
                {downloads != null && (
                  <span className={cx(BADGE, "flex items-center gap-1")}>
                    <Download className="size-3" aria-hidden />
                    {t("plugins.hub.downloadsShort", {
                      n: downloads.toLocaleString(),
                    })}
                  </span>
                )}
              </div>
            </div>
          </header>

          {screenshots.length > 0 && (
            <PluginScreenshotCarousel images={screenshots} name={name} />
          )}

          {readme.status === "loading" && <CenteredSpinner className="py-8" />}
          {readme.status === "ready" && (
            <PluginReadme markdown={readme.markdown} repo={repo ?? ""} />
          )}
          {readme.status === "error" && (
            <p className="text-body-2-regular text-text-tertiary">
              {t("plugins.hub.readmeUnavailable")}
            </p>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-body-medium text-text-primary">
              {t("plugins.hub.infoTitle")}
            </h3>
            <div className="grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                {category && (
                  <InfoRow label={t("plugins.hub.infoCategory")}>
                    {t(`plugins.hub.categories.${category}`)}
                  </InfoRow>
                )}
                {author && (
                  <InfoRow label={t("plugins.hub.author")}>{author}</InfoRow>
                )}
                {version && <InfoRow label={t("plugins.hub.version")}>v{version}</InfoRow>}
                {minAppVersion && (
                  <InfoRow label={t("plugins.hub.minAppVersion")}>{minAppVersion}</InfoRow>
                )}
                {sdkVersion && (
                  <InfoRow label={t("plugins.hub.sdkVersion")}>{sdkVersion}</InfoRow>
                )}
                {installed && installed.installedAt > 0 && (
                  <InfoRow label={t("plugins.hub.installedAt")}>
                    {new Date(installed.installedAt).toLocaleDateString(i18n.language)}
                  </InfoRow>
                )}
              </div>
              {repo && (
                <div className="flex flex-col gap-2">
                  <span className="text-body-2-regular text-text-tertiary">
                    {t("plugins.hub.infoLinks")}
                  </span>
                  <div className="flex flex-col items-start gap-1.5">
                    <ExternalLink
                      label={t("plugins.hub.repo")}
                      url={`https://github.com/${repo}`}
                    />
                    <ExternalLink
                      label={t("plugins.hub.releases")}
                      url={`https://github.com/${repo}/releases`}
                    />
                    <ExternalLink
                      label={t("plugins.hub.issues")}
                      url={`https://github.com/${repo}/issues`}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-body-medium text-text-primary">
              {t("plugins.hub.permissionsTitle")}
            </h3>
            {permissions.length === 0 ? (
              <span className="text-body-2-regular text-text-tertiary">
                {t("plugins.hub.permissionsEmpty")}
              </span>
            ) : (
              <ul className="flex flex-col gap-1">
                {permissions.map((permission) => {
                  const label = describePermission(permission);
                  return (
                    <li
                      key={permission}
                      className="flex items-center gap-2 text-body-2-regular text-text-secondary"
                    >
                      <span
                        aria-hidden
                        className="size-1 shrink-0 rounded-full bg-foreground-icon-secondary"
                      />
                      {t(label.key, label.params ?? {})}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
