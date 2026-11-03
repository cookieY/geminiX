import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "@/app/providers/app-providers";
import { AppRouter } from "@/app/router/app-router";
import "@/app/styles/global.css";

async function bootstrap(): Promise<void> {
  const rootElement = document.getElementById("root");
  if (rootElement === null) {
    throw new Error("root element missing from index.html");
  }
  // The MSW worker must own the network before the first query fires
  // (code-generation-policy.json mock_layer): a request that escapes to the
  // real server would be judged anonymous and flip the app to /login.
  if (import.meta.env.VITE_ENABLE_MOCK === "true") {
    const module = await import("@/shared/mock/browser");
    await module.startMockWorker();
  }
  // Dev-only UI annotation helper (RCP-20261103-FE-AGENTATION-DEV-TOOL).
  // import.meta.env.DEV is statically false in production builds, so Vite
  // drops this branch and the package never reaches dist/. No endpoint is
  // configured: annotations are copied manually, nothing is synced.
  let devTools: ReactNode = null;
  if (import.meta.env.DEV) {
    try {
      const { clearAgentationStorage } = await import("@/shared/dev/agentation-cleanup");
      clearAgentationStorage();
      const { Agentation } = await import("agentation");
      devTools = <Agentation />;
    } catch (error) {
      // A dev-only toolbar must never stop the app from rendering.
      console.warn("Agentation dev toolbar unavailable", error);
    }
  }
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
      {devTools}
    </StrictMode>,
  );
}

void bootstrap();
