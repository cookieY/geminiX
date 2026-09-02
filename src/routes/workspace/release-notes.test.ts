import { describe, expect, it } from "vitest";
import { summarizeReleaseNotes } from "./release-notes";

describe("summarizeReleaseNotes", () => {
  it("renders plain body text unchanged", () => {
    expect(summarizeReleaseNotes("修复了若干问题并优化性能")).toBe("修复了若干问题并优化性能");
  });

  it("strips markdown structure: headings, lists, emphasis, links, code", () => {
    const body = [
      "## What's Changed",
      "",
      "- **工程化**: upgrade `vite` to 8.0",
      "- fix: 查询导出截断 [GH-123](https://github.com/cookieY/Yearning/pull/123)",
      "",
      "1. 第一点",
      "> 引用块",
    ].join("\n");
    const summary = summarizeReleaseNotes(body, 200);
    expect(summary).not.toMatch(/[#*`>[\](),]/);
    expect(summary).toContain("What's Changed");
    expect(summary).toContain("工程化");
    expect(summary).toContain("upgrade vite to 8.0");
    expect(summary).toContain("GH-123");
    expect(summary).toContain("第一点");
  });

  it("truncates at 50 characters with an ellipsis (owner ruling)", () => {
    const long = "字".repeat(80);
    const summary = summarizeReleaseNotes(long);
    expect(summary).toHaveLength(51);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("keeps bodies at or under the limit intact", () => {
    expect(summarizeReleaseNotes("字".repeat(50))).toHaveLength(50);
  });
});
