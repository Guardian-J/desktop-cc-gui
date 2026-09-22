import { useTranslation } from "react-i18next";
import Download from "lucide-react/dist/esm/icons/download";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import SquareArrowOutUpRight from "lucide-react/dist/esm/icons/square-arrow-out-up-right";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import X from "lucide-react/dist/esm/icons/x";
import { ModalShell } from "@/components/dialogs";
import { isWeb, openExternal } from "@/lib/platform";
import type { MarketPlugin, PluginInfo } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { PluginAvatar } from "./PluginAvatar";
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

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-28 shrink-0 text-body-2-regular text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 text-body-2-regular text-text-primary">{children}</span>
    </div>
  );
}

/**
 * Unified detail for one plugin: the index row (`entry`) and/or the installed
 * record. Rendered from live store lookups by the caller, so an install that
 * finishes while the dialog is open switches it to the installed state.
 */
export function PluginDetailDialog({
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

  const openSettings = () => {
    if (!settingsKey) return;
    onClose();
    window.location.hash = `#/settings?page=${encodeURIComponent(settingsKey)}`;
  };

  return (
    <ModalShell
      onClose={onClose}
      label={t("plugins.hub.detailTitle")}
      className="flex max-h-[calc(100dvh-64px)] w-[540px] max-w-[calc(100vw-32px)] flex-col"
      dialogClassName="flex min-h-0 flex-col gap-4"
    >
      <div className="flex items-start gap-3">
        <PluginAvatar id={id} name={name} size={48} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body-medium text-text-primary">{name}</span>
            {version && <span className={BADGE}>v{version}</span>}
            {tier && (
              <span className={BADGE}>
                {t(tier === "declarative" ? "plugins.hub.tierDeclarative" : "plugins.hub.tierJs")}
              </span>
            )}
            {installed && (
              <span className={BADGE}>{t(`plugins.source.${installed.source}`, installed.source)}</span>
            )}
          </div>
          {description && (
            <p className="text-body-2-regular text-text-secondary">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col rounded-xl border border-separator-border px-4 py-1.5">
          {author && <MetaRow label={t("plugins.hub.author")}>{author}</MetaRow>}
          {version && <MetaRow label={t("plugins.hub.version")}>v{version}</MetaRow>}
          {repo && (
            <MetaRow label={t("plugins.hub.repo")}>
              <button
                type="button"
                onClick={() => openExternal(`https://github.com/${repo}`)}
                className="flex cursor-pointer items-center gap-1 text-text-brand-secondary hover:underline"
              >
                {repo}
                <SquareArrowOutUpRight className="size-3.5" aria-hidden />
              </button>
            </MetaRow>
          )}
          {minAppVersion && (
            <MetaRow label={t("plugins.hub.minAppVersion")}>{minAppVersion}</MetaRow>
          )}
          {sdkVersion && <MetaRow label={t("plugins.hub.sdkVersion")}>{sdkVersion}</MetaRow>}
          {downloads != null && (
            <MetaRow label={t("plugins.hub.downloadsLabel")}>
              {t("plugins.hub.downloadsShort", { n: downloads.toLocaleString() })}
            </MetaRow>
          )}
          {installed && installed.installedAt > 0 && (
            <MetaRow label={t("plugins.hub.installedAt")}>
              {new Date(installed.installedAt).toLocaleDateString(i18n.language)}
            </MetaRow>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-body-medium text-text-primary">
            {t("plugins.hub.permissionsTitle")}
          </span>
          {permissions.length === 0 ? (
            <span className="text-body-2-regular text-text-tertiary">
              {t("plugins.hub.permissionsEmpty")}
            </span>
          ) : (
            <ul className="flex flex-col gap-1">
              {permissions.map((permission) => {
                const label = describePermission(permission);
                return (
                  <li key={permission} className="flex items-center gap-2 text-body-2-regular text-text-secondary">
                    <span aria-hidden className="size-1 shrink-0 rounded-full bg-foreground-icon-secondary" />
                    {t(label.key, label.params ?? {})}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
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
    </ModalShell>
  );
}
