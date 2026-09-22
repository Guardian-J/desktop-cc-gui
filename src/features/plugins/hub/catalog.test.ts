import { describe, expect, it } from "vitest";
import type { MarketPlugin } from "@/lib/ipc";
import {
  categorizePlugin,
  groupByCategory,
  pluginAvatarGradient,
  pluginInitial,
  pluginMatchesQuery,
  selectFeatured,
  sortByDownloads,
} from "./catalog";

const entry = (id: string, overrides: Partial<MarketPlugin> = {}): MarketPlugin => ({
  id,
  repo: `owner/${id}`,
  name: id,
  description: "",
  author: "tester",
  tier: "js",
  version: "1.0.0",
  minAppVersion: null,
  sdkVersion: null,
  permissions: [],
  downloads: null,
  ...overrides,
});

describe("categorizePlugin", () => {
  it("classifies the real index entries the way the sections promise", () => {
    expect(
      categorizePlugin({
        id: "react-doctor",
        name: "React Doctor",
        description: "一键运行 npx react-doctor@latest 代码体检",
      }),
    ).toBe("dev");
    expect(
      categorizePlugin({
        id: "auto-title",
        name: "会话自动命名",
        description: "每轮对话结束后生成会话标题",
      }),
    ).toBe("productivity");
    expect(
      categorizePlugin({
        id: "composer-rainbow-border",
        name: "彩虹跑马灯边界线",
        description: "为聊天输入框添加沿边界持续流动的彩虹跑马灯效果",
      }),
    ).toBe("appearance");
    expect(
      categorizePlugin({
        id: "model-switcher",
        name: "模型与供应商助手",
        description: "模型与 CLI 选择、供应商渠道切换、全局主题",
      }),
    ).toBe("integration");
  });

  it("falls back to 其他 when nothing matches", () => {
    expect(categorizePlugin({ id: "mystery", name: "Mystery", description: "?" })).toBe("other");
  });
});

describe("pluginInitial", () => {
  it("uppercases latin initials and keeps CJK / emoji intact", () => {
    expect(pluginInitial("react-doctor")).toBe("R");
    expect(pluginInitial("会话自动命名")).toBe("会");
    // Code-point iteration: the emoji stays one unit, not half a surrogate.
    expect(pluginInitial("🎨 themes")).toBe("🎨");
    expect(pluginInitial("   ")).toBe("?");
  });
});

describe("pluginAvatarGradient", () => {
  it("is deterministic per id and picks from the palette", () => {
    expect(pluginAvatarGradient("auto-title")).toEqual(pluginAvatarGradient("auto-title"));
    const { from, to } = pluginAvatarGradient("auto-title");
    expect(from).toMatch(/^#[0-9a-f]{6}$/i);
    expect(to).toMatch(/^#[0-9a-f]{6}$/i);
    expect(from).not.toBe(to);
  });
});

describe("sortByDownloads", () => {
  it("ranks counted entries first, then name, and does not mutate the input", () => {
    const input = [
      entry("b", { downloads: 5, name: "B" }),
      entry("c", { downloads: null, name: "C" }),
      entry("a", { downloads: 5, name: "A" }),
      entry("d", { downloads: 9, name: "D" }),
    ];
    expect(sortByDownloads(input).map((item) => item.id)).toEqual(["d", "a", "b", "c"]);
    expect(input.map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
  });
});

describe("selectFeatured", () => {
  it("returns [] when the index carries no stats (an arbitrary set is not 精选)", () => {
    expect(selectFeatured([entry("a"), entry("b")])).toEqual([]);
  });

  it("takes the most-downloaded entries up to the limit", () => {
    const featured = selectFeatured(
      [
        entry("a", { downloads: 1 }),
        entry("b", { downloads: 30 }),
        entry("c", { downloads: 10 }),
        entry("d", { downloads: 20 }),
      ],
      2,
    );
    expect(featured.map((item) => item.id)).toEqual(["b", "d"]);
  });
});

describe("groupByCategory", () => {
  it("renders categories in fixed order and drops empty ones", () => {
    const groups = groupByCategory([
      entry("rainbow", { name: "彩虹", description: "彩虹主题" }),
      entry("doctor", { name: "Doctor", description: "代码体检" }),
      entry("misc", { name: "Misc", description: "nothing" }),
    ]);
    expect(groups.map((group) => group.category)).toEqual(["dev", "appearance", "other"]);
    expect(groups[0].entries.map((item) => item.id)).toEqual(["doctor"]);
  });
});

describe("pluginMatchesQuery", () => {
  const item = entry("auto-title", {
    name: "会话自动命名",
    description: "生成标题",
    author: "zhukunpeng",
  });

  it("matches id, name, description and author, case-insensitively", () => {
    expect(pluginMatchesQuery(item, "AUTO")).toBe(true);
    expect(pluginMatchesQuery(item, "自动")).toBe(true);
    expect(pluginMatchesQuery(item, "标题")).toBe(true);
    expect(pluginMatchesQuery(item, "zhukunpeng")).toBe(true);
    expect(pluginMatchesQuery(item, "missing")).toBe(false);
    expect(pluginMatchesQuery(item, "  ")).toBe(true);
  });
});
