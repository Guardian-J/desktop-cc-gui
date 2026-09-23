import { describe, expect, it } from "vitest";
import {
  defaultWorktreePath,
  dirNameOf,
  isPlausibleBranchName,
  joinPath,
  parentDirOf,
  parsePrInput,
  sanitizeDirName,
  slugifyTitle,
  suggestPrBranch,
} from "./pr-input";

describe("parsePrInput", () => {
  it("accepts bare numbers and #-prefixed numbers", () => {
    expect(parsePrInput("1842")).toBe(1842);
    expect(parsePrInput("  #1842 ")).toBe(1842);
  });

  it("extracts the number from GitHub PR URLs with any suffix", () => {
    expect(parsePrInput("https://github.com/o/r/pull/1842")).toBe(1842);
    expect(parsePrInput("https://github.com/o/r/pull/1842/files")).toBe(1842);
    expect(parsePrInput("https://github.com/o/r/pull/1842?diff=split")).toBe(1842);
  });

  it("rejects non-PR input", () => {
    expect(parsePrInput("")).toBeNull();
    expect(parsePrInput("abc")).toBeNull();
    expect(parsePrInput("0")).toBeNull();
    expect(parsePrInput("https://github.com/o/r/issues/12")).toBeNull();
    expect(parsePrInput("https://github.com/o/r/pull/")).toBeNull();
    expect(parsePrInput("pr-1842")).toBeNull();
  });
});

describe("slugifyTitle", () => {
  it("keeps at most the first four ASCII words as kebab-case", () => {
    expect(slugifyTitle("Refactor workspace sidebar into sections v2")).toBe(
      "refactor-workspace-sidebar-into",
    );
    expect(slugifyTitle("fix: Crash on quit!")).toBe("fix-crash-on-quit");
  });

  it("returns empty for titles without ASCII content", () => {
    expect(slugifyTitle("修复侧边栏")).toBe("");
    expect(slugifyTitle("!!!")).toBe("");
  });
});

describe("suggestPrBranch", () => {
  it("appends the slug when a title is known, falls back to bare pr-N", () => {
    expect(suggestPrBranch(1842, "Add worktree support for parallel review")).toBe(
      "pr-1842-add-worktree-support-for",
    );
    expect(suggestPrBranch(1842, "修复")).toBe("pr-1842");
    expect(suggestPrBranch(1842, null)).toBe("pr-1842");
    expect(suggestPrBranch(1842)).toBe("pr-1842");
  });
});

describe("isPlausibleBranchName", () => {
  it("accepts ordinary branch names", () => {
    expect(isPlausibleBranchName("feature/parallel-review")).toBe(true);
    expect(isPlausibleBranchName("pr-1842-add-x")).toBe(true);
  });

  it("rejects names git check-ref-format would reject", () => {
    for (const bad of [
      "",
      "has space",
      "tilde~1",
      "caret^",
      "quest?",
      "star*",
      "brack[et",
      "dots..",
      "-leading-dash",
      "/leading-slash",
      "trailing/",
      "file.lock",
    ]) {
      expect(isPlausibleBranchName(bad)).toBe(false);
    }
  });
});

describe("path helpers", () => {
  it("split and join with forward separators", () => {
    expect(parentDirOf("/repo/app")).toBe("/repo");
    expect(dirNameOf("/repo/app")).toBe("app");
    expect(joinPath("/repo", "child")).toBe("/repo/child");
    expect(joinPath("/repo/", "child")).toBe("/repo/child");
  });

  it("keep the filesystem root as its own parent", () => {
    expect(parentDirOf("/app")).toBe("/");
  });

  it("split and join with backslash separators", () => {
    expect(parentDirOf("C:\\repo\\app")).toBe("C:\\repo");
    expect(dirNameOf("C:\\repo\\app")).toBe("app");
    expect(joinPath("C:\\repo", "child")).toBe("C:\\repo\\child");
  });

  it("sanitizeDirName flattens nested branch names", () => {
    expect(sanitizeDirName("feature/parallel/review")).toBe("feature-parallel-review");
  });
});

describe("defaultWorktreePath", () => {
  it("places worktrees in a sibling <repo>-worktrees directory", () => {
    expect(defaultWorktreePath("/repo/app", "pr-1842-x")).toBe(
      "/repo/app-worktrees/pr-1842-x",
    );
    expect(defaultWorktreePath("/repo/app", "feature/x")).toBe(
      "/repo/app-worktrees/feature-x",
    );
    expect(defaultWorktreePath("C:\\repo\\app", "b")).toBe("C:\\repo\\app-worktrees\\b");
  });
});
