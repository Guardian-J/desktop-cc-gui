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
  {
    id: "claude",
    label: "Claude",
    path: "/home/u/.claude/skills",
    readonly: false,
    available: true,
  },
  {
    id: "codex",
    label: "Codex",
    path: "/home/u/.codex/skills",
    readonly: false,
    available: true,
  },
  {
    id: "grok",
    label: "Grok",
    path: "/home/u/.grok/skills",
    readonly: false,
    available: true,
  },
  // Not installed and no copy anywhere: hidden from rows and chips.
  {
    id: "hermes",
    label: "Hermes",
    path: "/home/u/.hermes/skills",
    readonly: false,
    available: false,
  },
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
    targetStates: { claude: "synced", codex: "off", grok: "off", hermes: "off" },
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
    targetStates: { claude: "synced", codex: "orphan", grok: "off", hermes: "off" },
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
    // 单目标动作的反馈点名引擎，不说成整体结果。
    expect(document.body.textContent).toContain("已同步到 Codex");
    expect(document.body.textContent).not.toContain("全部目标同步完成");
  });

  it("toggles one engine from the row icon without opening the dialog", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "codex", ok: true, error: null }],
    } satisfies SkillMutationResult);
    await renderPane();
    const rowIcons = () =>
      document.querySelectorAll<HTMLButtonElement>('button[data-target="codex"]');
    expect(rowIcons().length).toBeGreaterThan(0);
    await act(async () => {
      rowIcons()[0].click();
    });
    expect(api.setTargets).toHaveBeenCalledWith("anthropics/skills:alpha", [
      "claude",
      "codex",
    ]);
    expect(document.querySelector('[aria-label="alpha 详情"]')).toBeNull();

    // 本地技能点引擎图标 = 先纳管再同步（与详情面板同一条路径）。
    api.importLocal.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "grok", ok: true, error: null }],
    } satisfies SkillMutationResult);
    await act(async () => {
      document
        .querySelectorAll<HTMLButtonElement>('button[data-target="grok"]')[1]
        .click();
    });
    expect(api.importLocal).toHaveBeenCalledWith("beta", ["claude", "grok"]);
  });

  it("shows engine state in the row icons and hides uninstalled engines", async () => {
    await renderPane();
    const stateOf = (row: Element | null | undefined, engine: string) =>
      row?.querySelector<HTMLButtonElement>(`button[data-target="${engine}"]`)?.dataset
        .targetState;
    const alphaRow = document.querySelector('[aria-label="查看 alpha 详情"]')?.parentElement;
    expect(stateOf(alphaRow, "claude")).toBe("synced");
    expect(stateOf(alphaRow, "codex")).toBe("off");
    expect(stateOf(alphaRow, "grok")).toBe("off");
    // 未安装且无副本的引擎不出现在行里，也不出现在筛选 chips 里。
    expect(alphaRow?.querySelector('button[data-target="hermes"]')).toBeNull();
    expect(
      [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.trim() === "Hermes",
      ),
    ).toBe(false);

    // beta 的 codex 副本丢失：图标标出 orphan，点击即重新同步。
    const betaRow = document.querySelector('[aria-label="查看 beta 详情"]')?.parentElement;
    expect(stateOf(betaRow, "codex")).toBe("orphan");
    expect(betaRow?.querySelector('button[data-target="codex"]')?.getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("keeps a user-owned local copy and says so instead of claiming removal", async () => {
    const synced = installedPayload([
      managedSkill({
        targets: ["claude", "grok"],
        targetStates: { claude: "synced", codex: "off", grok: "synced", hermes: "off" },
      }),
      localSkill(),
    ]);
    api.installed.mockResolvedValueOnce(synced).mockResolvedValue(synced);
    // 后端把“保留用户自己的来源副本”报成 kept：UI 不能说成已移除。
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "grok", ok: true, error: null, kept: true }],
    } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    const grok = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) =>
      label.textContent?.includes("Grok"),
    );
    await act(async () => {
      grok?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
    });
    expect(document.body.textContent).toContain("保留了你自己的本地副本（Grok）");
  });

  it("locks turning off a local skill's own copies and offers installed engines on import", async () => {
    await renderPane();
    const betaRow = document.querySelector('[aria-label="查看 beta 详情"]')?.parentElement;
    const localCopy = betaRow?.querySelector<HTMLButtonElement>('button[data-target="claude"]');
    expect(localCopy?.dataset.targetState).toBe("synced");
    expect(localCopy?.disabled).toBe(true);
    expect(localCopy?.getAttribute("title")).toContain("应用不会删除它");

    await act(async () => {
      buttonExact("导入本地技能").click();
    });
    const labels = [...document.querySelectorAll("label")].map((label) => label.textContent?.trim());
    expect(labels).toContain("Claude");
    expect(labels).toContain("Codex");
    expect(labels).toContain("Grok");
    // 未安装的引擎不出现在导入目标里。
    expect(labels.some((label) => label?.includes("Hermes"))).toBe(false);
  });

  it("filters the list by an engine chip", async () => {
    await renderPane();
    await act(async () => {
      buttonExact("Grok").click();
    });
    expect(document.body.textContent).toContain("没有符合筛选条件的 Skill");
    expect(document.body.textContent).not.toContain("managed skill");
  });

  it("reports a failed engine toggle instead of an all-synced message", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "codex", ok: false, error: "permission denied" }],
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
    expect(document.body.textContent).toContain("Codex 同步失败：permission denied");
    expect(document.body.textContent).not.toContain("全部目标同步完成");
  });

  it("shows invocation activity and the remove-from-all-agents action", async () => {
    api.usage.mockResolvedValue({
      engine: "claude",
      scope: "claude_code_transcripts",
      generatedAt: Date.now(),
      scannedFiles: 3,
      totalInvocations: 4,
      cached: false,
      skills: [
        {
          skill: "alpha",
          invocations: 4,
          lastUsedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          tokens: null,
          installed: true,
          skillId: "anthropics/skills:alpha",
          directory: "alpha",
        },
      ],
      unusedInstalled: [],
    });
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(api.usage).toHaveBeenCalled();
    expect(document.body.textContent).toContain("调用次数");
    expect(document.body.textContent).toContain("2 天前");
    expect(document.body.textContent).toContain("同步到");
    // 托管技能：以「从所有 Agent 移除」作为唯一的销毁入口（内联确认）。
    await act(async () => {
      buttonByText("从所有 Agent 移除").click();
    });
    expect(document.body.textContent).toContain("卸载 alpha？");
  });

  it("marks never-used skills instead of fabricating activity", async () => {
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(document.body.textContent).toContain("从未使用");
    expect(document.body.textContent).toContain("尚未调用");
  });

  it("uninstalls through a confirmation and offers the trash restore", async () => {
    api.uninstall.mockResolvedValue({
      ok: true,
      trashed: true,
      restoreId: "anthropics/skills:alpha",
      ttlMs: 300000,
    } satisfies SkillMutationResult);
    api.restore.mockResolvedValue({ ok: true } satisfies SkillMutationResult);
    api.installed
      .mockResolvedValueOnce(installedPayload([managedSkill(), localSkill()]))
      .mockResolvedValue(installedPayload([localSkill()]));
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    await act(async () => {
      buttonByText("从所有 Agent 移除").click();
    });
    expect(document.body.textContent).toContain("卸载 alpha？");
    await act(async () => {
      buttonByText("确认").click();
    });
    expect(api.uninstall).toHaveBeenCalledWith("anthropics/skills:alpha");
    // 行从列表消失后详情面板自动关闭（选中项由列表派生）。
    expect(document.querySelector('[aria-label="alpha 详情"]')).toBeNull();

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
