import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketPlugin, PluginInfo } from "@/lib/ipc";

const pluginFetchIndex = vi.fn(async (_force?: boolean): Promise<MarketPlugin[]> => []);
const pluginCheckUpdates = vi.fn(async () => []);
const pluginFetchMarketReadme = vi.fn(
  async (_id: string): Promise<string> => "# React Doctor\n\n一键运行代码体检。",
);
const pluginList = vi.fn(async (): Promise<PluginInfo[]> => []);
const pluginInstallFromMarketplace = vi.fn(async (id: string) =>
  installedPlugin({ id, enabled: true }),
);
const pluginUninstall = vi.fn(async (_id: string, _deleteData: boolean) => {});
const pluginSetEnabled = vi.fn(async (id: string, enabled: boolean) =>
  installedPlugin({ id, enabled }),
);
vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginFetchIndex: (force?: boolean) => pluginFetchIndex(force),
    pluginFetchMarketReadme: (id: string) => pluginFetchMarketReadme(id),
    pluginCheckUpdates: () => pluginCheckUpdates(),
    pluginList: () => pluginList(),
    pluginInstallFromMarketplace: (id: string) => pluginInstallFromMarketplace(id),
    pluginUninstall: (id: string, deleteData: boolean) => pluginUninstall(id, deleteData),
    pluginSetEnabled: (id: string, enabled: boolean) => pluginSetEnabled(id, enabled),
  },
}));
vi.mock("@/lib/events", () => ({
  listenPluginInstallProgress: vi.fn(async () => () => {}),
}));
const openExternal = vi.fn((_url: string) => {});
vi.mock("@/lib/platform", () => ({
  isWeb: false,
  openExternal: (url: string) => openExternal(url),
  pickDirectory: vi.fn(async () => null),
}));
// Stable empty snapshot: useSyncExternalStore loops forever on a fresh [].
const STATES_SNAPSHOT: never[] = [];
vi.mock("../runtime/loader", () => ({
  bootstrapPlugins: vi.fn(async () => []),
  getPluginStatesSnapshot: () => STATES_SNAPSHOT,
  ipcBackend: {},
  loadPlugin: vi.fn(async () => {}),
  reloadPlugin: vi.fn(async () => {}),
  pluginsBootstrapped: () => true,
  prunePluginRuntimeState: vi.fn(),
  subscribePluginStates: () => () => {},
  unloadPlugin: vi.fn(),
}));
vi.mock("../builtin", () => ({ BUILTIN_PLUGINS: [] }));

import i18n from "@/lib/i18n";
import { PluginHub } from "./PluginHub";
import { usePluginHubStore } from "./store";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; PillTabList measures its selection thumb with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const DOWNLOADS = 47;

const MARKET_ENTRY: MarketPlugin = {
  id: "react-doctor",
  repo: "zhukupenglinyutong/ccgui-plugin-react-doctor",
  name: "React Doctor",
  description: "一键运行代码体检",
  author: "zhukunpeng",
  tier: "js",
  version: "0.2.0",
  minAppVersion: "1.0.0",
  sdkVersion: "^0.3",
  permissions: ["storage", "exec:claude", "ui:status-bar"],
  downloads: DOWNLOADS,
  screenshots: [
    "https://raw.githubusercontent.com/zhukupenglinyutong/ccgui-plugin-react-doctor/HEAD/docs/shot-1.png",
    "https://raw.githubusercontent.com/zhukupenglinyutong/ccgui-plugin-react-doctor/HEAD/docs/shot-2.png",
  ],
};

function installedPlugin(overrides: Partial<PluginInfo> & { id: string }): PluginInfo {
  return {
    name: "会话自动命名",
    version: "0.7.0",
    description: "每轮对话结束后生成会话标题",
    author: "zhukunpeng",
    tier: "js",
    source: "marketplace",
    enabled: true,
    quarantined: false,
    lastError: null,
    permissions: ["storage"],
    installedAt: 1_700_000_000_000,
    minAppVersion: "1.0.2",
    ...overrides,
  };
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`button containing ${text} not found`);
  return button;
}

describe("PluginHub", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginFetchIndex.mockImplementation(async () => [MARKET_ENTRY]);
    pluginCheckUpdates.mockImplementation(async () => []);
    pluginList.mockImplementation(async () => []);
    usePluginsStore.setState({ installed: [], loaded: true, error: null, installing: null });
    useMarketplaceStore.setState({
      entries: [],
      loaded: true,
      error: null,
      updates: [],
      installing: null,
    });
    usePluginHubStore.setState({ open: true, active: true, view: "market" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container.remove();
    root = null;
  });

  async function render() {
    await act(async () => {
      root!.render(<PluginHub />);
    });
  }

  it("browses the market with featured/category sections and installs from +", async () => {
    await render();

    expect(document.body.textContent).toContain("React Doctor");
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.sectionFeatured"));
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.categories.dev"));

    await act(async () => {
      buttonByLabel(i18n.t("plugins.hub.install")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(pluginInstallFromMarketplace).toHaveBeenCalledWith("react-doctor");
  });

  it("marks installed market entries with a check instead of the install button", async () => {
    pluginList.mockImplementation(async () => [installedPlugin({ id: "react-doctor" })]);
    await render();
    await act(async () => {
      // The market view refreshes the installed list on mount.
    });

    expect(document.body.querySelector('button[aria-label="安装"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="已安装"]')).not.toBeNull();
  });

  it("hides the download badge when the index has no stats", async () => {
    pluginFetchIndex.mockImplementation(async () => [{ ...MARKET_ENTRY, downloads: null }]);
    await render();
    expect(document.body.textContent).not.toContain(DOWNLOADS.toLocaleString());
  });

  it("opens the full-page detail: carousel, README, permissions and repo link", async () => {
    await render();
    await act(async () => {
      buttonContaining("React Doctor").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The README arrives through a mocked IPC round-trip in an effect.
    await act(async () => {});

    expect(pluginFetchMarketReadme).toHaveBeenCalledWith("react-doctor");
    // The detail owns the whole surface — the browse chrome is gone.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.backToList"));
    expect(
      document.body.querySelector(
        `button[aria-label="${i18n.t("plugins.hub.refresh")}"]`,
      ),
    ).toBeNull();
    // README markdown rendered below the hero.
    expect(document.body.textContent).toContain("一键运行代码体检。");
    // Carousel: two screenshots, counter + navigation affordances.
    expect(
      document.body.textContent,
    ).toContain(i18n.t("plugins.hub.screenshotCounter", { current: 1, total: 2 }));
    expect(buttonByLabel(i18n.t("plugins.hub.screenshotNext"))).toBeDefined();

    expect(document.body.textContent).toContain(i18n.t("plugins.hub.permissionsTitle"));
    // Grant-shaped permissions read as sentences, not raw ids.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.permissions.storage"));
    expect(document.body.textContent).toContain("claude");

    const repoLink = [...document.body.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(i18n.t("plugins.hub.repo")),
    );
    expect(repoLink).toBeDefined();
    await act(async () => {
      repoLink!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openExternal).toHaveBeenCalledWith(`https://github.com/${MARKET_ENTRY.repo}`);

    // Back returns to the browse surface.
    await act(async () => {
      buttonByLabel(i18n.t("plugins.hub.backToList")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.sectionFeatured"));
  });

  it("manages installed plugins: uninstall confirmation and quarantine retry", async () => {
    usePluginHubStore.setState({ view: "installed" });
    pluginList.mockImplementation(async () => [
      installedPlugin({ id: "auto-title" }),
      installedPlugin({ id: "broken", name: "Broken", quarantined: true, enabled: false }),
    ]);
    await render();
    // refresh() runs in an effect; flush the mocked IPC round-trip.
    await act(async () => {});
    expect(document.body.textContent).toContain("会话自动命名");
    // Quarantined rows surface the explicit reload affordance.
    expect(buttonByLabel(i18n.t("plugins.reload"))).toBeDefined();

    // Quarantine → retry re-enables through the backend's trust-it-again upsert.
    await act(async () => {
      buttonByLabel(i18n.t("plugins.reload")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pluginSetEnabled).toHaveBeenCalledWith("broken", true);

    // Uninstall goes through the real modal.
    await act(async () => {
      buttonByLabel(i18n.t("plugins.uninstall")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.body.textContent).toContain(
      i18n.t("plugins.uninstallConfirm", { name: "会话自动命名" }),
    );
    await act(async () => {
      buttonByText(i18n.t("common.confirm")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pluginUninstall).toHaveBeenCalledWith("auto-title", false);
  });

  it("keeps the development guide behind the header entry", async () => {
    await render();
    expect(document.body.textContent).not.toContain(i18n.t("plugins.market.localTitle"));

    await act(async () => {
      buttonByText(i18n.t("plugins.hub.guide")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.body.textContent).toContain(i18n.t("plugins.market.developTitle"));
    expect(document.body.textContent).toContain(i18n.t("plugins.market.localTitle"));
    expect(document.body.textContent).toContain(i18n.t("plugins.market.submitTitle"));
  });
});
