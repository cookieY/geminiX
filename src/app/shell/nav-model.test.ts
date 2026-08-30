import { describe, expect, it } from "vitest";
import { filterNavGroups, NAV_GROUPS } from "./nav-model";

describe("navigation IA baseline (spec §5.1)", () => {
  it("declares exactly the five authority groups in order", () => {
    expect(NAV_GROUPS.map((group) => group.labelKey)).toEqual([
      "nav.group.workspace",
      "nav.group.audit",
      "nav.group.query",
      "nav.group.admin",
      "nav.group.reviewEngine",
    ]);
  });

  it("has no AI group and no chat route — v4 has no chat shell", () => {
    const flat = NAV_GROUPS.flatMap((group) => group.items);
    expect(flat.some((item) => item.labelKey.toLowerCase().includes("ai"))).toBe(false);
    expect(flat.some((item) => item.to.includes("chat"))).toBe(false);
  });

  it("admin and review-engine entries are admin-visible only", () => {
    for (const group of NAV_GROUPS.filter(
      (candidate) =>
        candidate.labelKey === "nav.group.admin" ||
        candidate.labelKey === "nav.group.reviewEngine",
    )) {
      for (const item of group.items) {
        expect(item.visibility).toBe("admin");
      }
    }
  });
});

describe("filterNavGroups", () => {
  it("hides every admin group from a plain user", () => {
    const visible = filterNavGroups(NAV_GROUPS, "user");
    const labelKeys = visible.map((group) => group.labelKey);
    expect(labelKeys).not.toContain("nav.group.admin");
    expect(labelKeys).not.toContain("nav.group.reviewEngine");
    expect(labelKeys).toEqual([
      "nav.group.workspace",
      "nav.group.audit",
      "nav.group.query",
    ]);
  });

  it("shows every group to admin", () => {
    const visible = filterNavGroups(NAV_GROUPS, "admin");
    expect(visible).toHaveLength(NAV_GROUPS.length);
  });

  it("drops a group entirely when all of its entries are filtered out", () => {
    const adminGroup = NAV_GROUPS.find(
      (candidate) => candidate.labelKey === "nav.group.admin",
    );
    if (!adminGroup) throw new Error("admin group missing from NAV_GROUPS");
    const singleAdminGroup = [
      { labelKey: "nav.group.admin", items: adminGroup.items },
    ];
    expect(filterNavGroups(singleAdminGroup, "user")).toEqual([]);
  });
});
