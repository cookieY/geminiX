import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { BusinessError, TransportError } from "@/shared/api/mutator";
import { getMyDashboard } from "@/api/generated/client/dashboard/dashboard";
import {
  MOCK_SCENARIOS,
  useMockScenario,
  type MockScenario,
} from "@/shared/mock/scenario-store";

/**
 * FE-F1 skeleton proof: drives the generated client through the single
 * sanctioned mutator against the four MSW scenarios (ready, blocked, running,
 * error), demonstrating typed business errors, transport errors and ready
 * data before the real backend exists. The page itself is scaffolding and is
 * replaced by the FE-F2 app shell.
 */
export default function SkeletonPage() {
  const { t } = useTranslation();
  const scenario = useMockScenario((state) => state.scenario);
  const setScenario = useMockScenario((state) => state.setScenario);

  const probe = useQuery({
    queryKey: ["skeleton-probe", scenario],
    queryFn: async () => {
      try {
        const data = await getMyDashboard();
        return { outcome: "ready" as const, data };
      } catch (error) {
        if (error instanceof BusinessError) {
          return {
            outcome: "blocked" as const,
            errCode: error.err_code,
            catalogName: error.catalogEntry?.name ?? "UNDECLARED",
          };
        }
        if (error instanceof TransportError) {
          return { outcome: "error" as const, title: error.problem.title, status: error.problem.status };
        }
        throw error;
      }
    },
    enabled: false,
    retry: false,
  });

  const applyScenario = (next: MockScenario) => {
    setScenario(next);
    probe.refetch().then(
      () => undefined,
      () => undefined,
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">{t("app.name")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("app.skeleton")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("skeleton.mockScenario")}</CardTitle>
          <CardDescription>{t("skeleton.apiBase")}: {import.meta.env.VITE_API_BASE_URL || "(same-origin)"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {MOCK_SCENARIOS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={scenario === value ? "default" : "outline"}
              onClick={() => {
                applyScenario(value);
              }}
            >
              {t(`skeleton.api${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">getMyDashboard</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {probe.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-busy="true">
              <div className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              {t("skeleton.apiRunning")}
            </div>
          )}
          {probe.data?.outcome === "ready" && (
            <Alert>
              <AlertTitle>{t("skeleton.apiReady")}</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                refreshed_at: {(probe.data.data as unknown as { refreshed_at: string }).refreshed_at}
              </AlertDescription>
            </Alert>
          )}
          {probe.data?.outcome === "blocked" && (
            <Alert variant="destructive">
              <AlertTitle>
                {t("skeleton.apiBlocked")} <Badge variant="outline">{probe.data.catalogName}</Badge>
              </AlertTitle>
              <AlertDescription className="font-mono text-xs">err_code = {probe.data.errCode}</AlertDescription>
            </Alert>
          )}
          {probe.data?.outcome === "error" && (
            <Alert variant="destructive">
              <AlertTitle>{t("skeleton.apiError")}</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {probe.data.title} (status {probe.data.status})
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
