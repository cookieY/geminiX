import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AppProviders } from "@/app/providers/app-providers";
import { appRouter } from "@/app/router/router";
import "@/app/styles/global.css";

if (import.meta.env.VITE_ENABLE_MOCK === "true") {
  void import("@/shared/mock/browser").then((module) => module.startMockWorker());
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element missing from index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={appRouter} />
    </AppProviders>
  </StrictMode>,
);
