import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BROWSER_TAB_PREFIX, useBrowserStore } from "@/features/browser/store";
import {
  MISSION_WORKBENCH_TAB_KEY,
  resetMissionStore,
  useMissionStore,
} from "@/features/mission/store";
import { PLUGIN_HUB_TAB_KEY, usePluginHubStore } from "@/features/plugins/hub/store";
import { useBetaFeaturesStore } from "@/features/settings/beta-features";
import { useChatStore } from "./store";
import { useChatTabs } from "./use-chat-tabs";

/**
 * 内测入口（设置 → 其他 → 内测功能）的展示 gate：关闭时浏览器/任务工作台
 * 页签与中心面整体隐藏；开启（或中途切换）时立即出现。
 */

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BROWSER_TAB = { id: "b1", url: "https://example.com", title: "Example" };

function Probe() {
  const {
    tabItems,
    activeTabKey,
    browserTabs,
    activeBrowserId,
    pluginHubOpen,
    pluginHubActive,
    missionOpen,
    missionActive,
  } = useChatTabs({ setDialog: () => {} });
  return (
    <div>
      <span data-testid="keys">{tabItems.map((item) => item.key).join(",")}</span>
      <span data-testid="active">{activeTabKey ?? ""}</span>
      <span data-testid="browser-count">{String(browserTabs.length)}</span>
      <span data-testid="browser-active">{activeBrowserId ?? ""}</span>
      <span data-testid="hub-open">{String(pluginHubOpen)}</span>
      <span data-testid="hub-active">{String(pluginHubActive)}</span>
      <span data-testid="mission-open">{String(missionOpen)}</span>
      <span data-testid="mission-active">{String(missionActive)}</span>
    </div>
  );
}

function text(id: string): string {
  return document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useChatStore.setState({
    active: null,
    openTabs: [],
    sessions: [],
    unseen: {},
    streamingByKey: {},
  });
  useBrowserStore.setState({ tabs: [BROWSER_TAB], activeId: BROWSER_TAB.id });
  resetMissionStore();
  useMissionStore.setState({ open: true, active: true });
  usePluginHubStore.setState({ open: false, active: false, view: "market" });
  useBetaFeaturesStore.setState({ features: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useBrowserStore.setState({ tabs: [], activeId: null });
  resetMissionStore();
  usePluginHubStore.setState({ open: false, active: false, view: "market" });
});

function render() {
  act(() => root.render(<Probe />));
}

describe("useChatTabs beta entry gate", () => {
  it("hides browser and mission tabs while the beta entries are off", () => {
    render();
    expect(text("keys")).toBe("");
    expect(text("browser-count")).toBe("0");
    expect(text("browser-active")).toBe("");
    expect(text("mission-open")).toBe("false");
    expect(text("mission-active")).toBe("false");
    expect(text("active")).toBe("");
  });

  it("shows them once both switches are on", () => {
    useBetaFeaturesStore.setState({
      features: { newBrowser: true, missionWorkbench: true },
    });
    render();
    expect(text("keys")).toBe(`${BROWSER_TAB_PREFIX}b1,${MISSION_WORKBENCH_TAB_KEY}`);
    expect(text("browser-count")).toBe("1");
    expect(text("browser-active")).toBe("b1");
    expect(text("mission-open")).toBe("true");
    expect(text("mission-active")).toBe("true");
    expect(text("active")).toBe(`${BROWSER_TAB_PREFIX}b1`);
  });

  it("reacts to a flag flip without remounting", () => {
    render();
    expect(text("keys")).toBe("");
    act(() => {
      useBetaFeaturesStore.setState({ features: { newBrowser: true } });
    });
    expect(text("keys")).toBe(`${BROWSER_TAB_PREFIX}b1`);
    act(() => {
      useBetaFeaturesStore.setState({ features: { newBrowser: false } });
    });
    expect(text("keys")).toBe("");
  });

  it("shows the plugin hub tab without any beta flag and routes the active key to it", () => {
    useMissionStore.setState({ open: true, active: false });
    act(() => {
      usePluginHubStore.setState({ open: true, active: true, view: "market" });
    });
    render();
    expect(text("keys")).toBe(PLUGIN_HUB_TAB_KEY);
    expect(text("hub-open")).toBe("true");
    expect(text("hub-active")).toBe("true");
    expect(text("active")).toBe(PLUGIN_HUB_TAB_KEY);
  });
});
