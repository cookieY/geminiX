import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Toaster } from "@/shared/components/ui/sonner";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
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
          <TooltipProvider>
            <SessionProvider>{children}</SessionProvider>
          </TooltipProvider>
          {/* The header is a floating card pinned to the viewport top and
              carries the refresh control at its right edge. A top-right toast
              at sonner's default offset lands exactly on that control and
              swallows the next click, so feedback would block the action it
              reports. Push the stack below the header band (4px margin + 48px
              control row + gap) instead of letting it overlap. */}
          <Toaster position="top-right" offset={{ top: 68, right: 16 }} />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
