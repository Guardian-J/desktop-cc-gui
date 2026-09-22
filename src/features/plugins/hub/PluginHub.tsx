import { useState } from "react";
import { useTranslation } from "react-i18next";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { isWeb } from "@/lib/platform";
import { usePluginHubStore } from "./store";
import { PluginDetailDialog } from "./PluginDetailDialog";
import { PluginInstalledView } from "./PluginInstalledView";
import { PluginMarketView } from "./PluginMarketView";
import { DevelopGuideDialog } from "./DevelopGuideDialog";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

const HEADER_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-primary-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-70";

/**
 * 插件 hub (native center tab): 市场 storefront + 已安装 manager, opened from
 * the sidebar entry and the palette commands. Replaces the two settings
 * sections — the settings rail now only carries plugin-registered settings
 * pages.
 */
export function PluginHub() {
  const { t } = useTranslation();
  const view = usePluginHubStore((s) => s.view);
  const setView = usePluginHubStore((s) => s.setView);
  const installed = usePluginsStore((s) => s.installed);
  const installing = usePluginsStore((s) => s.installing);
  const installFromDirectory = usePluginsStore((s) => s.installFromDirectory);
  const entries = useMarketplaceStore((s) => s.entries);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // Live lookups: an install that finishes while the dialog is open flips it
  // to the installed state without reopening.
  const detailEntry = detailId ? entries.find((entry) => entry.id === detailId) : undefined;
  const detailInstalled = detailId
    ? installed.find((plugin) => plugin.id === detailId)
    : undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background-primary-default">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-separator-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="shrink-0 text-title-3-medium text-text-primary">
            {t("plugins.hub.title")}
          </h1>
          <PillTabList>
            <PillTab
              variant="gray"
              isSelected={view === "market"}
              onSelect={() => setView("market")}
            >
              {t("plugins.hub.marketTab")}
            </PillTab>
            <PillTab
              variant="gray"
              isSelected={view === "installed"}
              onSelect={() => setView("installed")}
            >
              {t("plugins.hub.installedTab")}
            </PillTab>
          </PillTabList>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={!!installing || isWeb}
            title={isWeb ? t("plugins.market.desktopOnly") : undefined}
            onClick={() => void installFromDirectory()}
            className={HEADER_BUTTON}
          >
            {installing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FolderInput className="size-4" aria-hidden />
            )}
            {installing
              ? installing.total > 0
                ? t("plugins.installingPct", {
                    pct: Math.round((installing.done / installing.total) * 100),
                  })
                : t("plugins.installing")
              : t("plugins.hub.installLocal")}
          </button>
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            className={HEADER_BUTTON}
          >
            <BookOpen className="size-4" aria-hidden />
            {t("plugins.hub.guide")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-2 px-6 py-6">
          {view === "market" ? (
            <PluginMarketView onOpenDetail={setDetailId} />
          ) : (
            <PluginInstalledView onOpenDetail={setDetailId} />
          )}
        </div>
      </div>

      {detailId && (
        <PluginDetailDialog
          id={detailId}
          entry={detailEntry}
          installed={detailInstalled}
          onClose={() => setDetailId(null)}
        />
      )}
      {guideOpen && <DevelopGuideDialog onClose={() => setGuideOpen(false)} />}
    </div>
  );
}
