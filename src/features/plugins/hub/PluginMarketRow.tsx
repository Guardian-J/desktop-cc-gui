import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Download from "lucide-react/dist/esm/icons/download";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import { isWeb } from "@/lib/platform";
import type { MarketPlugin } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { PluginAvatar } from "./PluginAvatar";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";
const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";

/** Round install affordance on the right of a market row — check marks
 *  current installs, download installs, and an update gets a text button so
 *  the version is visible. Spinner while this row installs. */
export function MarketRowAction({ entry }: { entry: MarketPlugin }) {
  const { t } = useTranslation();
  const installed = usePluginsStore((s) => s.installed.some((p) => p.id === entry.id));
  const installedPlugin = usePluginsStore((s) => s.installed.find((p) => p.id === entry.id));
  const update = useMarketplaceStore((s) => s.updates.find((u) => u.id === entry.id));
  const installing = useMarketplaceStore((s) => s.installing);
  const install = useMarketplaceStore((s) => s.install);

  if (installing?.id === entry.id) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground-icon-secondary">
        <Loader2 className="size-4 animate-spin" aria-hidden />
      </span>
    );
  }
  // Builtins are always on: no install/update affordance at all.
  if (installedPlugin?.source === "builtin") {
    return (
      <span
        aria-label={t("plugins.hub.installed")}
        title={t("plugins.hub.installed")}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-accent-500"
      >
        <Check className="size-4" aria-hidden />
      </span>
    );
  }
  // Installed and current: the check carries the state (clicking the row
  // itself opens details / uninstall).
  if (installed && !update) {
    return (
      <span
        aria-label={t("plugins.hub.installed")}
        title={t("plugins.hub.installed")}
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-accent-500"
      >
        <Check className="size-4" aria-hidden />
      </span>
    );
  }
  if (update) {
    return (
      <button
        type="button"
        disabled={!!installing || isWeb}
        title={isWeb ? t("plugins.market.desktopOnly") : undefined}
        onClick={() => void install(entry.id)}
        className="shrink-0 cursor-pointer whitespace-nowrap rounded-lg bg-background-secondary-default px-3 py-1.5 text-body-2-medium text-text-primary transition-colors hover:bg-background-secondary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t("plugins.hub.updateTo", { version: update.latestVersion })}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={t("plugins.hub.install")}
      title={isWeb ? t("plugins.market.desktopOnly") : t("plugins.hub.install")}
      disabled={!!installing || isWeb}
      onClick={() => void install(entry.id)}
      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-button-default text-foreground-icon-secondary transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Download className="size-4" aria-hidden />
    </button>
  );
}

/** One marketplace row: identity is a button (opens details), the action is
 *  a sibling button — never nested. */
export function PluginMarketRow({
  entry,
  onOpenDetail,
}: {
  entry: MarketPlugin;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-background-primary-hover">
      <PluginAvatar id={entry.id} name={entry.name} />
      <button
        type="button"
        onClick={() => onOpenDetail(entry.id)}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left"
      >
        <span className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-body-medium text-text-primary">{entry.name}</span>
          <span className={BADGE}>v{entry.version}</span>
          {entry.downloads != null && (
            <span className={cx(BADGE, "flex items-center gap-1")}>
              <Download className="size-3" aria-hidden />
              {entry.downloads.toLocaleString()}
            </span>
          )}
          {entry.author && (
            <span className="truncate text-xs text-text-tertiary">{entry.author}</span>
          )}
        </span>
        {entry.description && (
          <span className="w-full truncate text-body-2-regular text-text-secondary">
            {entry.description}
          </span>
        )}
      </button>
      <MarketRowAction entry={entry} />
    </div>
  );
}
