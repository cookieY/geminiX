import { StrictMode } from "react";
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
  createRoot(rootElement).render(
    <StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </StrictMode>,
  );
}

void bootstrap();
