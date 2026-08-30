import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Toaster } from "@/shared/components/ui/sonner";
import { createQueryClient } from "./query-provider";
import { ThemeProvider } from "./theme-provider";
import { SessionProvider } from "@/features/auth/session-provider";
import { ErrorBoundary } from "./error-boundary";
import "@/shared/i18n";

export function AppProviders({ children }: { children: ReactNode }) {
  const queryClient = useMemo(() => createQueryClient(), []);
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>{children}</SessionProvider>
          <Toaster position="top-right" />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
