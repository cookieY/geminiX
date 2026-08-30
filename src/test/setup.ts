import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./msw/server";
import { applyScenarioToServer } from "@/shared/mock/scenarios";

// jsdom does not implement matchMedia; shell components (sidebar, theme,
// reduced-motion checks) rely on it. Individual tests may override with
// vi.stubGlobal as theme-provider.test.tsx does.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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
