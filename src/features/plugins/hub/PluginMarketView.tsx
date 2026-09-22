import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { Select, SelectItem } from "@/components/base/select/select";
import { Input } from "@/components/base/input/input";
import { CenteredSpinner } from "@/components/base/empty-state";
import {
  categorizePlugin,
  groupByCategory,
  PLUGIN_CATEGORIES,
  pluginMatchesQuery,
  selectFeatured,
  type PluginCategory,
} from "./catalog";
import { PluginMarketRow } from "./PluginMarketRow";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

const SELECT_TRIGGER = "min-w-32";

/** One titled block of market rows. */
function MarketSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-2">
      <h3 className="px-1 text-body-medium text-text-primary">{title}</h3>
      <div className="flex flex-col divide-y divide-separator-border rounded-2xl border border-separator-border bg-background-primary-default">
        {children}
      </div>
    </section>
  );
}

/** 市场 tab: hero + search/filter toolbar + 精选 / category sections. */
export function PluginMarketView({ onOpenDetail }: { onOpenDetail: (id: string) => void }) {
  const { t } = useTranslation();
  const { entries, loaded, error, fetchIndex, checkUpdates } = useMarketplaceStore();
  const refreshInstalled = usePluginsStore((s) => s.refresh);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | PluginCategory>("all");
  const refreshAction = useActionFeedback({ spin: true });
  const refreshing = refreshAction.feedback === "running";

  const handleRefresh = () => {
    if (refreshing) return;
    void refreshAction.start(
      () => fetchIndex(true),
      // fetchIndex reports failure through store state instead of throwing.
      () => useMarketplaceStore.getState().error != null,
    );
  };

  useEffect(() => {
    void fetchIndex();
    void checkUpdates();
    // Installed state decides install/update/✓ — make sure it's current even
    // if the user opens the hub before ever visiting 已安装.
    void refreshInstalled();
  }, [fetchIndex, checkUpdates, refreshInstalled]);

  const filtering = query.trim().length > 0 || category !== "all";
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          pluginMatchesQuery(entry, query) &&
          (category === "all" || categorizePlugin(entry) === category),
      ),
    [entries, query, category],
  );
  // 精选 only in the default unfiltered view — a filtered list is a result
  // set, not a storefront.
  const featured = useMemo(() => (filtering ? [] : selectFeatured(filtered)), [filtering, filtered]);
  const featuredIds = useMemo(() => new Set(featured.map((entry) => entry.id)), [featured]);
  const groups = useMemo(
    () => groupByCategory(filtered.filter((entry) => !featuredIds.has(entry.id))),
    [filtered, featuredIds],
  );
  const availableCategories = useMemo(
    () => PLUGIN_CATEGORIES.filter((item) => entries.some((e) => categorizePlugin(e) === item)),
    [entries],
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border border-separator-border bg-background-secondary-default px-6 py-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-accent-500/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-64 rounded-full bg-accent-300/20 blur-3xl"
        />
        <h2 className="relative text-title-2-medium text-text-primary">
          {t("plugins.hub.heroTitle")}
        </h2>
        <p className="relative mt-1 max-w-xl text-body-regular text-text-secondary">
          {t("plugins.hub.heroSubtitle")}
        </p>
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={setQuery}
            placeholder={t("plugins.hub.searchPlaceholder")}
            className="w-72 max-w-full"
          />
          <Select
            aria-label={t("plugins.hub.categoryAll")}
            selectedKey={category}
            onSelectionChange={(key) => setCategory(String(key) as "all" | PluginCategory)}
            triggerClassName={SELECT_TRIGGER}
          >
            <SelectItem id="all">{t("plugins.hub.categoryAll")}</SelectItem>
            {availableCategories.map((item) => (
              <SelectItem key={item} id={item}>
                {t(`plugins.hub.categories.${item}`)}
              </SelectItem>
            ))}
          </Select>
          <button
            type="button"
            aria-label={t("plugins.hub.refresh")}
            title={t("plugins.hub.refresh")}
            disabled={refreshing}
            onClick={handleRefresh}
            className="cursor-pointer rounded-lg p-2 text-foreground-icon-secondary transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary disabled:cursor-default disabled:opacity-60"
          >
            <ActionFeedbackIcon
              icon={RefreshCw}
              feedback={refreshAction.feedback}
              spin
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background-secondary-default px-4 py-2 text-body-medium text-text-error-primary">
          <span className="min-w-0 flex-1 truncate">
            {t("plugins.hub.loadFailed")}: {error}
          </span>
          <button
            type="button"
            onClick={() => void fetchIndex(true)}
            className="cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-text-primary hover:bg-background-primary-hover"
          >
            {t("plugins.market.retry")}
          </button>
        </div>
      )}

      {!loaded ? (
        <CenteredSpinner className="py-16" />
      ) : filtered.length === 0 ? (
        <p className="px-1 py-10 text-center text-body-regular text-text-tertiary">
          {entries.length === 0 ? t("plugins.hub.empty") : t("plugins.hub.noMatch")}
        </p>
      ) : (
        <>
          {featured.length > 0 && (
            <MarketSection title={t("plugins.hub.sectionFeatured")}>
              {featured.map((entry) => (
                <PluginMarketRow key={entry.id} entry={entry} onOpenDetail={onOpenDetail} />
              ))}
            </MarketSection>
          )}
          {groups.map((group) => (
            <MarketSection
              key={group.category}
              title={t(`plugins.hub.categories.${group.category}`)}
            >
              {group.entries.map((entry) => (
                <PluginMarketRow key={entry.id} entry={entry} onOpenDetail={onOpenDetail} />
              ))}
            </MarketSection>
          ))}
          <p className="px-1 text-body-2-regular text-text-tertiary">
            {t("plugins.market.hint")}
          </p>
        </>
      )}
    </div>
  );
}
