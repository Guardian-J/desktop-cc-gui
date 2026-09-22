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

/** Item labels under one section heading. The rail renders every group as a
 *  heading directly above its item buttons, so the heading scopes the
 *  lookup: a static heading span's parent is the group, a collapsible
 *  heading is a chevron toggle wrapping the label. Folded items stay in the
 *  DOM (the md+ rail hides the list with a class), so they still count. */
function itemsUnder(labelKey: string): string[] {
  const label = i18n.t(labelKey);
  const heading = [...document.querySelectorAll("nav span")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!heading) throw new Error(`section heading not rendered: ${labelKey}`);
  const group =
    heading.closest("button")?.parentElement ?? heading.parentElement;
  return [
    ...(group?.querySelectorAll("button:not([aria-expanded])") ?? []),
  ].map((button) => button.textContent?.trim() ?? "");
}

/** Chevron toggle of a collapsible group (item rows never carry the
 *  attribute, so it identifies the heading button on its own). */
function groupToggle(labelKey: string): HTMLButtonElement {
  const label = i18n.t(labelKey);
  const toggle = [
    ...document.querySelectorAll<HTMLButtonElement>("nav button[aria-expanded]"),
  ].find((button) => button.textContent?.trim() === label);
  if (!toggle) throw new Error(`group toggle not rendered: ${labelKey}`);
  return toggle;
}

/** Item list a group heading owns (the heading's next sibling). */
function itemsContainerOf(labelKey: string): HTMLElement {
  const label = i18n.t(labelKey);
  const heading = [...document.querySelectorAll("nav button, nav span")].find(
    (el) => el.textContent?.trim() === label,
  );
  const container = heading?.nextElementSibling;
  if (!(container instanceof HTMLElement)) {
    throw new Error(`item list not rendered: ${labelKey}`);
  }
  return container;
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

async function render(engines: EngineInfo[], page = "stub") {
  useChatStore.setState({ engines });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/settings?page=${page}`]}>
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

    // 其他 holds the release/feedback pages plus the 内测功能 gate — engine
    // sections used to lead that group.
    expect(itemsUnder("settings.groupMisc")).toEqual([
      i18n.t("settings.checkUpdates"),
      i18n.t("settings.about"),
      i18n.t("settings.betaFeatures"),
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

    // Headings stay visible while folded, so every bucket is discoverable.
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

  it("folds the two buckets by default and toggles them on click", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
    ]);

    // CLI 管理 starts open; 未安装 and 未启用 start folded (their lists carry
    // the md+ hide class so the mobile rail keeps every item).
    expect(groupToggle("settings.cliManage").getAttribute("aria-expanded")).toBe(
      "true",
    );
    for (const key of [
      "settings.cliNotInstalledGroup",
      "settings.cliDisabledGroup",
    ]) {
      expect(groupToggle(key).getAttribute("aria-expanded")).toBe("false");
      expect(itemsContainerOf(key).className).toContain("md:hidden");
    }

    act(() => groupToggle("settings.cliNotInstalledGroup").click());
    expect(groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(itemsContainerOf("settings.cliNotInstalledGroup").className).not.toContain(
      "md:hidden",
    );

    act(() => groupToggle("settings.cliNotInstalledGroup").click());
    expect(groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("leaves the other rail groups as static headings", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
    ]);

    // Only the three CLI sections fold.
    expect(document.querySelectorAll("nav button[aria-expanded]").length).toBe(3);
    const systemHeading = [...document.querySelectorAll("nav span")].find(
      (el) => el.textContent?.trim() === i18n.t("settings.groupSystem"),
    );
    expect(systemHeading).toBeTruthy();
    expect(systemHeading?.closest("button")).toBeNull();
  });

  it("unfolds the bucket that holds a deep-linked page", async () => {
    // A CLI-keyed stub section (unknown engine id) lands in 未安装 once the
    // probe is in, and renders a stub body instead of a real config page.
    const dispose = settingsRegistry.register({
      id: "cli:stubcli",
      key: "cli:stubcli",
      label: () => "Stub CLI",
      group: "cli",
      order: 98,
      component: () => <div>stub cli page</div>,
    });
    try {
      await render([engine("claude", true, true)], "cli:stubcli");

      expect(
        groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded"),
      ).toBe("true");
      // The fold is user-owned: collapsing it now must stick.
      act(() => groupToggle("settings.cliNotInstalledGroup").click());
      expect(
        groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded"),
      ).toBe("false");
    } finally {
      // Dropping the stub re-renders the open page back to General (the
      // unknown-key fallback) and GeneralSection resolves a probe on mount;
      // flush both inside act like every other render in this file.
      await act(async () => {
        dispose();
      });
    }
  });
});
