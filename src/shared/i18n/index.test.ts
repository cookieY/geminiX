import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, resolveLocale, setLocale, toggleLocale } from "@/shared/i18n";

describe("locale resolution", () => {
  it("falls back to zh-CN when nothing is stored and the browser language is unmatched", () => {
    localStorage.removeItem("yearning-locale");
    Object.defineProperty(navigator, "language", { value: "fr-FR", configurable: true });
    expect(resolveLocale()).toBe("zh-CN");
  });

  it("maps a matched browser language without storing a user choice", () => {
    localStorage.removeItem("yearning-locale");
    Object.defineProperty(navigator, "language", { value: "en-US", configurable: true });
    expect(resolveLocale()).toBe("en-US");
  });

  it("maps the zh prefix even for unlisted regional variants", () => {
    localStorage.removeItem("yearning-locale");
    Object.defineProperty(navigator, "language", { value: "zh-TW", configurable: true });
    expect(resolveLocale()).toBe("zh-CN");
  });

  it("the explicit user choice outranks the browser language", () => {
    setLocale("en-US");
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
    expect(resolveLocale()).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("toggleLocale flips between the two locales and persists the choice", () => {
    setLocale("zh-CN");
    toggleLocale();
    expect(localStorage.getItem("yearning-locale")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    toggleLocale();
    expect(localStorage.getItem("yearning-locale")).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("declares exactly the two first-release locales", () => {
    expect(LOCALES).toEqual(["zh-CN", "en-US"]);
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });
});
