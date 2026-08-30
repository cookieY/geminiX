import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";
import { applyScenarioToServer } from "@/shared/mock/scenarios";

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
