import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./msw/server";
import { applyScenarioToServer } from "@/shared/mock/scenarios";

// jsdom's native matchMedia always reports false, which would leave motion
// animations (submission wizard) running on rAF inside jsdom. Override
// unconditionally: report prefers-reduced-motion as matching so
// reducedMotion:"user" skips animations everywhere in component tests, and
// keep other media queries false. Individual tests may still override with
// vi.stubGlobal as theme-provider.test.tsx does.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom reports an en-US browser language; pin the locale so component tests
// assert against the default zh-CN vocabulary deterministically.
window.localStorage.setItem("yearning-locale", "zh-CN");

beforeAll(() => {
  server.listen({ onUnhandledRequest: "bypass" });
  applyScenarioToServer(server, "ready");
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
