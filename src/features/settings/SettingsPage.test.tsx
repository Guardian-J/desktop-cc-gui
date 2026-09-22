import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInfo } from "@/lib/ipc";

// The settings page never probes IPC for the rail itself (engine states come
// from the chat store); a rejecting-any-method proxy keeps section module
// imports and the stub page inert.
vi.mock("@/lib/ipc", () => ({
  ipc: new Proxy({}, { get: () => async () => null }),
}));

import { settingsRegistry } from "@ccgui/plugin-sdk";
import i18n from "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import SettingsPage from "./SettingsPage";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Landing page for every render: a registered stub keeps real section bodies
// (General/Usage/…) unmounted while the rail lists every registered section.
settingsRegistry.register({
  id: "stub",
  key: "stub",
  label: () => "Stub",
  group: "settings",
  order: 99,
  component: () => <div>stub page</div>,
});

const engine = (id: string, available: boolean, enabled: boolean): EngineInfo => ({
  id,
  available,
  enabled,
  supportsImages: false,
  permissions: [],
});

/** Row labels currently rendered in the nav rail (exact text, no substring
 *  collisions like "Qoder CLI" vs "Qoder CLI CN"). */
function navLabels(): string[] {
  const nav = document.querySelector("nav");
  if (!nav) throw new Error("nav rail not rendered");
  return [...nav.querySelectorAll("button, span")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
}

/** Item labels under one static section heading. The rail renders every
 *  group as a heading span directly above its item buttons, so the heading's
 *  parent scopes the lookup to that section. */
function itemsUnder(labelKey: string): string[] {
  const label = i18n.t(labelKey);
  const heading = [...document.querySelectorAll("nav span")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!heading) throw new Error(`section heading not rendered: ${labelKey}`);
  return [...(heading.parentElement?.querySelectorAll("button") ?? [])].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useChatStore.setState({ engines: [] });
});

async function render(engines: EngineInfo[]) {
  useChatStore.setState({ engines });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/settings?page=stub"]}>
        <SettingsPage />
      </MemoryRouter>,
    );
  });
}



describe("SettingsPage misc rail", () => {
  it("lists 检查更新 above 社区与反馈 as its own module", async () => {
    await render([]);

    const labels = navLabels();
    const updateAt = labels.indexOf(i18n.t("settings.checkUpdates"));
    const aboutAt = labels.indexOf(i18n.t("settings.about"));
    expect(updateAt).toBeGreaterThan(-1);
    expect(aboutAt).toBeGreaterThan(updateAt);
  });
});

describe("SettingsPage system rail", () => {
  it("keeps 智能体与提示词 and 网络代理 under 系统, after 快捷键", async () => {
    await render([]);

    expect(itemsUnder("settings.groupSystem")).toEqual([
      i18n.t("settings.general"),
      i18n.t("settings.webAccess"),
      i18n.t("shortcuts.sectionTitle"),
      i18n.t("settings.agentsPrompts"),
      i18n.t("settings.proxy"),
    ]);

    // 其他 keeps only the release/feedback pages — the two sections used to
    // lead that group.
    expect(itemsUnder("settings.groupMisc")).toEqual([
      i18n.t("settings.checkUpdates"),
      i18n.t("settings.about"),
    ]);
  });
});

describe("SettingsPage CLI rail", () => {
  it("buckets uninstalled CLIs under 未安装, disabled ones under 未启用", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
      engine("agy", false, false),
    ]);

    // Codex-style static sections: every group is visible on first render.
    const labels = navLabels();
    expect(labels).toContain("Claude Code");
    expect(labels).toContain("Codex CLI");
    expect(labels).toContain("Qoder CLI");
    expect(labels).toContain("Antigravity CLI");

    // Main rail holds only the installed+enabled CLI.
    expect(itemsUnder("settings.cliManage")).toEqual(["Claude Code"]);

    // 未安装 holds every uninstalled CLI (the probe lists 4 engines, the rail
    // registers all of them); 未启用 only the installed disabled one — an
    // uninstalled CLI never lands in the disabled bucket.
    const missingItems = itemsUnder("settings.cliNotInstalledGroup");
    expect(missingItems).toEqual(
      expect.arrayContaining(["Qoder CLI", "Antigravity CLI"]),
    );
    expect(missingItems).not.toContain("Claude Code");
    expect(missingItems).not.toContain("Codex CLI");
    expect(itemsUnder("settings.cliDisabledGroup")).toEqual(["Codex CLI"]);

    // 未安装 sorts before 未启用 in the rail.
    const missingAt = labels.indexOf(i18n.t("settings.cliNotInstalledGroup"));
    const disabledAt = labels.indexOf(i18n.t("settings.cliDisabledGroup"));
    expect(missingAt).toBeGreaterThan(-1);
    expect(disabledAt).toBeGreaterThan(missingAt);
  });

  it("keeps every CLI while the engine probe is out (empty list = unknown)", async () => {
    await render([]);

    const labels = navLabels();
    expect(labels).toContain("Claude Code");
    expect(labels).toContain("Qoder CLI");
    expect(labels).toContain("Antigravity CLI");
  });
});
