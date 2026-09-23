import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SkillMutationResult,
  SkillRow,
  SkillsInstalledResult,
} from "./types";

const api = vi.hoisted(() => ({
  installed: vi.fn(),
  discover: vi.fn(),
  search: vi.fn(),
  popular: vi.fn(),
  repos: vi.fn(),
  updates: vi.fn(),
  activity: vi.fn(),
  usage: vi.fn(),
  content: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  restore: vi.fn(),
  setTargets: vi.fn(),
  importLocal: vi.fn(),
  deleteLocal: vi.fn(),
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
}));

vi.mock("./api", () => ({
  SkillsHubError: class SkillsHubError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  skillsHubApi: api,
}));

vi.mock("@/lib/transport", () => ({ isWeb: false }));

vi.mock("@/features/files/MarkdownPreview", () => ({
  MarkdownPreview: ({ draft }: { draft: string }) => <pre data-testid="markdown">{draft}</pre>,
}));

import "@/lib/i18n";
import { SkillsSection } from "./SkillsSection";
import { InstalledPane } from "./InstalledPane";

// jsdom has no ResizeObserver; PillTabList measures with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TARGETS = [
  { id: "claude", label: "Claude", path: "/home/u/.claude/skills", readonly: false },
  { id: "codex", label: "Codex", path: "/home/u/.codex/skills", readonly: false },
];

function managedSkill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "anthropics/skills:alpha",
    key: "anthropics/skills:alpha",
    name: "alpha",
    description: "managed skill",
    directory: "alpha",
    sourceDirectory: "alpha",
    readmeUrl: "https://github.com/anthropics/skills/blob/main/alpha/SKILL.md",
    repoOwner: "anthropics",
    repoName: "skills",
    repoBranch: "main",
    installedAt: 1,
    managed: true,
    sourceKind: "managed",
    readonly: false,
    targets: ["claude"],
    targetStates: { claude: "synced", codex: "off" },
    ...overrides,
  };
}

function localSkill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "local:beta",
    key: "local:beta",
    name: "beta",
    description: "local skill",
    directory: "beta",
    readmeUrl: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    installedAt: null,
    managed: false,
    sourceKind: "local",
    readonly: false,
    targets: ["claude"],
    targetStates: { claude: "synced", codex: "orphan" },
    targetPaths: { claude: "/home/u/.claude/skills/beta" },
    ...overrides,
  };
}

function installedPayload(skills: SkillRow[]): SkillsInstalledResult {
  return { targets: TARGETS, skills, generatedAt: Date.now() };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.installed.mockResolvedValue(installedPayload([managedSkill(), localSkill()]));
  api.updates.mockResolvedValue({ updates: {}, checkedAt: Date.now(), cached: false });
  api.content.mockResolvedValue({
    directory: "alpha",
    path: "/home/u/.claude/skills/alpha/SKILL.md",
    markdown: "---\nname: alpha\n---\nbody",
    truncated: false,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPane() {
  await act(async () => {
    root.render(<InstalledPane onBrowse={() => undefined} />);
  });
}

function buttonByText(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

/** Exact-text match: chips share substrings with action buttons ("本地" is
 *  inside "导入本地技能"). */
function buttonExact(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found (exact): ${text}`);
  return button;
}

describe("InstalledPane", () => {
  it("lists skills with source badges and filters by source", async () => {
    await renderPane();
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");

    await act(async () => {
      buttonExact("本地").click();
    });
    expect(document.body.textContent).toContain("beta");
    expect(document.body.textContent).not.toContain("managed skill");
  });

  it("opens the detail dialog and syncs a second engine", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [
        { target: "claude", ok: true, error: null },
        { target: "codex", ok: true, error: null },
      ],
    } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(document.querySelector('[aria-label="alpha 详情"]')).toBeTruthy();

    const codex = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) =>
      label.textContent?.includes("Codex"),
    );
    const checkbox = codex?.querySelector<HTMLInputElement>("input[type=checkbox]");
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox?.click();
    });
    expect(api.setTargets).toHaveBeenCalledWith("anthropics/skills:alpha", [
      "claude",
      "codex",
    ]);
    expect(document.body.textContent).toContain("全部目标同步完成");
  });

  it("reports partial target failures instead of an all-synced message", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [
        { target: "claude", ok: true, error: null },
        { target: "codex", ok: false, error: "permission denied" },
      ],
    } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    const codex = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) =>
      label.textContent?.includes("Codex"),
    );
    await act(async () => {
      codex?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
    });
    expect(document.body.textContent).toContain("部分同步失败");
    expect(document.body.textContent).not.toContain("全部目标同步完成");
  });

  it("uninstalls through a confirmation and offers the trash restore", async () => {
    api.uninstall.mockResolvedValue({
      ok: true,
      trashed: true,
      restoreId: "anthropics/skills:alpha",
      ttlMs: 300000,
    } satisfies SkillMutationResult);
    api.restore.mockResolvedValue({ ok: true } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    await act(async () => {
      buttonByText("卸载").click();
    });
    expect(document.body.textContent).toContain("卸载 alpha？");
    await act(async () => {
      buttonByText("确认").click();
    });
    expect(api.uninstall).toHaveBeenCalledWith("anthropics/skills:alpha");

    await act(async () => {
      buttonByText("撤销卸载并恢复").click();
    });
    expect(api.restore).toHaveBeenCalledWith("anthropics/skills:alpha");
  });

  it("disables a row while its own mutation is pending, leaving others clickable", async () => {
    let release: (value: SkillMutationResult) => void = () => undefined;
    api.importLocal.mockImplementation(
      () =>
        new Promise<SkillMutationResult>((resolve) => {
          release = resolve;
        }),
    );
    await renderPane();
    const adoptButtons = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) => button.textContent?.trim() === "纳管",
      );
    expect(adoptButtons()).toHaveLength(1);
    await act(async () => {
      adoptButtons()[0].click();
    });
    // Only the pending row disables; the managed row's detail button stays live.
    expect(adoptButtons()[0].disabled).toBe(true);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent?.includes("alpha") && !button.disabled,
      ),
    ).toBe(true);

    await act(async () => {
      release({ ok: true });
    });
    expect(api.importLocal).toHaveBeenCalledTimes(1);
  });

  it("shows the SKILL.md content in the detail dialog", async () => {
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(api.content).toHaveBeenCalledWith("alpha");
    expect(document.querySelector('[data-testid="markdown"]')?.textContent).toContain(
      "name: alpha",
    );
  });
});

describe("SkillsSection usage and discovery safety", () => {
  it("does not load discovery or usage data until their tabs open", async () => {
    api.discover.mockResolvedValue({ skills: [], cached: false, generatedAt: 0 });
    api.popular.mockResolvedValue({ skills: [], cached: false, generatedAt: 0 });
    api.repos.mockResolvedValue({ repos: [] });
    api.usage.mockResolvedValue({
      engine: "claude",
      scope: "claude_code_transcripts",
      generatedAt: Date.now(),
      scannedFiles: 0,
      totalInvocations: 0,
      cached: false,
      skills: [],
      unusedInstalled: [],
    });
    api.activity.mockResolvedValue({ activity: [] });

    await act(async () => {
      root.render(<SkillsSection />);
    });
    expect(api.installed).toHaveBeenCalledTimes(1);
    expect(api.popular).not.toHaveBeenCalled();
    expect(api.usage).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText("发现", document.body).click();
    });
    expect(api.popular).toHaveBeenCalled();
    expect(api.usage).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText("使用情况", document.body).click();
    });
    expect(api.usage).toHaveBeenCalled();
  });
});
