import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Download from "lucide-react/dist/esm/icons/download";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import SquareArrowOutUpRight from "lucide-react/dist/esm/icons/square-arrow-out-up-right";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { CenteredSpinner } from "@/components/base/empty-state";
import { ConfirmDialog } from "@/components/dialogs";
import { isWeb, openExternal } from "@/lib/platform";
import { ipc, type MarketPlugin, type PluginInfo } from "@/lib/ipc";
import {
  categorizePlugin,
  githubAvatarUrl,
  githubLoginFor,
  indexUpdatedAt,
  isOfficialPlugin,
} from "./catalog";
import { PluginAvatar } from "./PluginAvatar";
import { usePluginArtwork } from "./artwork";
import { PluginReadme } from "./PluginReadme";
import { PluginScreenshotCarousel } from "./PluginScreenshotCarousel";
import { describePermission } from "./permissions";
import { usePluginSettingsKey } from "./use-plugin-settings-key";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";
const BADGE_OK = "rounded-md bg-status-lime-background px-1.5 py-0.5 text-xs text-status-lime-text";
const OFFICIAL_BADGE =
  "shrink-0 rounded-md bg-status-purple-background px-1.5 py-0.5 text-xs text-status-purple-text";
const RAIL_LABEL = "text-caption-1-regular text-text-tertiary";
const RAIL_VALUE = "text-body-2-regular text-text-primary";
const LINK_BUTTON =
  "flex w-fit cursor-pointer items-center gap-1 text-body-2-regular text-text-brand-secondary hover:underline";

/** Progress placeholder that keeps the medium Button's height while it runs. */
const INSTALLING_BUTTON =
  "flex h-9 items-center gap-1.5 rounded-2lg border border-border-button-default bg-background-primary-default px-2.5 text-body-medium whitespace-nowrap text-text-tertiary";

/**
 * Right-hand rail. It sticks under the detail header and, because its rows can
 * be taller than the window (a 22-permission plugin after 展开全部), it scrolls
 * inside that box: a pinned rail without a height bound pushed its 链接 rows
 * below the viewport, where only scrolling the README to its end revealed them.
 * 10.5rem: session tab strip 2.5 + hub header 3 + status bar 1.75 + sticky
 * top 1.5 + bottom gap 1.75. The rail scrolls from there, so taller window
 * chrome costs a few pixels of that gap instead of hiding rows.
 */
const RAIL =
  "flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100dvh-10.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-separator-border lg:pl-6";

/** One label + value block in the right-hand rail. */
function RailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={RAIL_LABEL}>{label}</span>
      {children}
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

/**
 * Developer identity in the rail. When the index resolves a GitHub account
 * (`githubLoginFor`: the indexed `author`, or the repo owner when `author` is
 * only a display name) the whole avatar + name chip links to that profile; a
 * display name alone stays inert text rather than pointing at a guessed URL.
 */
function AuthorChip({
  author,
  login,
  official,
}: {
  author: string;
  login: string | null;
  official: boolean;
}) {
  const { t } = useTranslation();
  const label = author || login || "";
  const chip = (
    <>
      {label && (
        <PluginAvatar
          id={label}
          name={label}
          src={login ? githubAvatarUrl(login, 20) : null}
          size={20}
          shape="circle"
        />
      )}
      <span className="truncate">{label || "—"}</span>
      {official && <span className={OFFICIAL_BADGE}>{t("plugins.hub.official")}</span>}
    </>
  );

  if (!login) return <span className="flex min-w-0 items-center gap-2">{chip}</span>;
  return (
    <button
      type="button"
      title={t("plugins.hub.authorGithub", { login })}
      onClick={() => openExternal(`https://github.com/${login}`)}
      className="flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    >
      {chip}
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
 * Grants in the rail: the count is always visible, the first four read as
 * sentences, and the rest stay one click away — collapsed by default so a
 * 20-permission plugin doesn't push everything else out of the rail.
 */
function PermissionList({ permissions }: { permissions: string[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (permissions.length === 0) {
    return <span className={RAIL_VALUE}>{t("plugins.hub.permissionsEmpty")}</span>;
  }
  const visible = expanded ? permissions : permissions.slice(0, 4);

  return (
    <div className="flex flex-col gap-1.5">
      <span className={RAIL_VALUE}>
        {t("plugins.hub.permissionsCount", { n: permissions.length })}
      </span>
      <ul className="flex flex-col gap-1">
        {visible.map((permission) => {
          const label = describePermission(permission);
          return (
            <li
              key={permission}
              className="flex items-start gap-2 text-body-2-regular text-text-secondary"
            >
              <span
                aria-hidden
                className="mt-2 size-1 shrink-0 rounded-full bg-foreground-icon-secondary"
              />
              {t(label.key, label.params ?? {})}
            </li>
          );
        })}
      </ul>
      {permissions.length > 4 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="w-fit cursor-pointer text-body-2-regular text-text-brand-secondary hover:underline"
        >
          {expanded
            ? t("plugins.hub.permissionsCollapse")
            : t("plugins.hub.permissionsExpand", { n: permissions.length })}
        </button>
      )}
    </div>
  );
}

/**
 * Full-page plugin detail (plan A layout): actions sit on the title row, the
 * long-form content owns the left column, and the metadata/permissions/links
 * rail is sticky on the right so it survives a README scroll.
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
  const installing = useMarketplaceStore((s) => (s.installing?.id === id ? s.installing : null));
  const update = useMarketplaceStore((s) => s.updates.find((u) => u.id === id));
  const uninstall = usePluginsStore((s) => s.uninstall);
  const settingsKey = usePluginSettingsKey(id);
  const readme = useMarketReadme(entry);
  const [confirming, setConfirming] = useState(false);

  const name = entry?.name ?? installed?.name ?? id;
  const description = installed?.description || entry?.description || "";
  const author = entry?.author || installed?.author || "";
  const version = installed?.version || entry?.version || "";
  const tier = installed?.tier ?? entry?.tier;
  const repo = entry?.repo;
  const authorLogin = githubLoginFor({ author, repo });
  // The installed record is the running truth; fall back to the indexed
  // manifest so a not-yet-installed plugin still lists its grants.
  const permissions = installed?.permissions.length
    ? installed.permissions
    : (entry?.permissions ?? []);
  const downloads = entry?.downloads ?? null;
  // Upstream freshness, not local install state: the index stamps this when
  // it registers the pinned release, so an old install still reads honestly.
  const updatedAt = indexUpdatedAt(entry?.updatedAt);
  const minAppVersion = entry?.minAppVersion ?? installed?.minAppVersion ?? null;
  const sdkVersion = entry?.sdkVersion ?? null;
  // Market-first artwork, with the installed manifest as the fallback for
  // plugins the index does not carry (locally developed ones).
  const artwork = usePluginArtwork(entry, installed);
  const screenshots = artwork.screenshots;
  const category = entry ? categorizePlugin(entry) : null;
  const installPct =
    installing && installing.total > 0
      ? Math.round((installing.done / installing.total) * 100)
      : null;

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
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("plugins.hub.backToList")}
        </button>
        <span className="min-w-0 truncate text-body-2-regular text-text-tertiary">
          {t("plugins.hub.title")} / {name}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-6">
          <header className="flex flex-wrap items-start gap-4">
            <PluginAvatar id={id} name={name} src={artwork.icon} size={56} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h2 className="text-title-3-medium text-text-primary">{name}</h2>
              {description && (
                <p className="max-w-2xl text-body-2-regular text-text-secondary">{description}</p>
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
                {installed && <span className={BADGE_OK}>{t("plugins.hub.installed")}</span>}
                {downloads != null && (
                  <span className={BADGE}>
                    {t("plugins.hub.downloadsShort", { n: downloads.toLocaleString() })}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1">
              {installing ? (
                <button type="button" disabled className={INSTALLING_BUTTON}>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {installPct != null
                    ? t("plugins.installingPct", { pct: installPct })
                    : t("plugins.installing")}
                </button>
              ) : entry && !installed ? (
                <Button
                  variant="primary"
                  leadingIcon={Download}
                  disabled={isWeb}
                  title={isWeb ? t("plugins.market.desktopOnly") : undefined}
                  onClick={() => void install(id)}
                >
                  {t("plugins.hub.install")}
                </Button>
              ) : null}
              {entry && update && (
                <Button
                  variant="primary"
                  leadingIcon={Download}
                  disabled={!!installing || isWeb}
                  title={isWeb ? t("plugins.market.desktopOnly") : undefined}
                  onClick={() => void install(id)}
                >
                  {t("plugins.hub.updateTo", { version: update.latestVersion })}
                </Button>
              )}
              {installed && settingsKey && (
                <Button variant="secondary" leadingIcon={Settings2} onClick={openSettings}>
                  {t("plugins.hub.openSettings")}
                </Button>
              )}
              {installed && installed.source !== "builtin" && (
                <Button
                  variant="danger"
                  leadingIcon={Trash2}
                  disabled={isWeb}
                  title={isWeb ? t("plugins.market.desktopOnly") : undefined}
                  onClick={() => setConfirming(true)}
                >
                  {t("plugins.uninstall")}
                </Button>
              )}
            </div>
          </header>

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_272px]">
            <div className="flex min-w-0 flex-col gap-6">
              <PluginScreenshotCarousel images={screenshots} name={name} />
              {readme.status === "loading" && <CenteredSpinner className="py-8" />}
              {readme.status === "ready" && (
                <PluginReadme markdown={readme.markdown} repo={repo ?? ""} />
              )}
              {readme.status === "error" && (
                <p className="text-body-2-regular text-text-tertiary">
                  {t("plugins.hub.readmeUnavailable")}
                </p>
              )}
              {!installed && entry && (
                <p className="text-body-2-regular text-text-tertiary">
                  {t("plugins.market.hint")}
                </p>
              )}
            </div>

            <aside className={RAIL}>
              <RailRow label={t("plugins.hub.author")}>
                <AuthorChip
                  author={author}
                  login={authorLogin}
                  official={isOfficialPlugin({ author, repo })}
                />
              </RailRow>

              {category && (
                <RailRow label={t("plugins.hub.infoCategory")}>
                  <span className={RAIL_VALUE}>{t(`plugins.hub.categories.${category}`)}</span>
                </RailRow>
              )}

              {tier && (
                <RailRow label={t("plugins.hub.tier")}>
                  <span className={RAIL_VALUE}>
                    {t(
                      tier === "declarative"
                        ? "plugins.hub.tierDeclarative"
                        : "plugins.hub.tierJs",
                    )}
                  </span>
                </RailRow>
              )}

              {(version || installed) && (
                <RailRow label={t("plugins.hub.version")}>
                  <span className={RAIL_VALUE}>v{version}</span>
                </RailRow>
              )}

              {(minAppVersion || sdkVersion) && (
                <RailRow label={t("plugins.hub.compatibility")}>
                  <span className={RAIL_VALUE}>
                    {minAppVersion && (
                      <span className="block">
                        {t("plugins.hub.minAppShort", { version: minAppVersion })}
                      </span>
                    )}
                    {sdkVersion && (
                      <span className="block">
                        {t("plugins.hub.sdkVersion")} {sdkVersion}
                      </span>
                    )}
                  </span>
                </RailRow>
              )}

              {downloads != null && (
                <RailRow label={t("plugins.hub.downloadsLabel")}>
                  <span className={RAIL_VALUE}>
                    {t("plugins.hub.downloadsShort", { n: downloads.toLocaleString() })}
                  </span>
                </RailRow>
              )}

              {updatedAt && (
                <RailRow label={t("plugins.hub.updatedAt")}>
                  <span className={RAIL_VALUE}>{updatedAt.toLocaleDateString(i18n.language)}</span>
                </RailRow>
              )}

              <RailRow label={t("plugins.hub.permissionsTitle")}>
                <PermissionList key={id} permissions={permissions} />
              </RailRow>

              {repo && (
                <RailRow label={t("plugins.hub.infoLinks")}>
                  <div className="flex flex-col items-start gap-1.5">
                    <ExternalLink label={t("plugins.hub.repo")} url={`https://github.com/${repo}`} />
                    <ExternalLink
                      label={t("plugins.hub.releases")}
                      url={`https://github.com/${repo}/releases`}
                    />
                    <ExternalLink
                      label={t("plugins.hub.issues")}
                      url={`https://github.com/${repo}/issues`}
                    />
                  </div>
                </RailRow>
              )}
            </aside>
          </div>
        </div>
      </div>

      {confirming && installed && (
        <ConfirmDialog
          danger
          message={t("plugins.uninstallConfirm", { name })}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onClose();
            void uninstall(installed, false);
          }}
        />
      )}
    </div>
  );
}
