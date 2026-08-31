import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assessSettingsImpact,
  createAiProvider,
  createDatasource,
  createKnowledgeEntry,
  createPromptTool,
  createRuleSet,
  deleteAiProvider,
  deleteDatasource,
  deleteKnowledgeEntry,
  deletePromptTool,
  deleteRuleSet,
  evaluateKnowledgeEntry,
  getDatasourceCapabilities,
  getSettingsNamespace,
  listAiProviders,
  listDatasources,
  listFlows,
  listKnowledgeEntries,
  listPromptTools,
  listRuleSets,
  listSettingsRevisions,
  replaceAiProvider,
  replaceDatasource,
  replaceKnowledgeEntry,
  replacePromptTool,
  replaceRuleSet,
  replaceSettingsNamespace,
  testAiProviderConnection,
  testDatasourceConnection,
} from "@/api/generated/client/administration/administration";
import { getTask } from "@/api/generated/client/tasks/tasks";
import { BusinessError } from "@/shared/api/mutator";
import { businessErrCodeByName } from "@/shared/api/error-display";
import type {
  AiProvider,
  AiProviderWrite,
  CreateAiProviderRequest,
  Datasource,
  DatasourceCapabilities,
  DatasourceWrite,
  KnowledgeEntry,
  KnowledgeEntryEvaluation,
  KnowledgeEntryWrite,
  PromptTool,
  PromptToolWrite,
  RuleSet,
  RuleSetWrite,
  SettingsImpactAssessment,
  SettingsRevision,
  SettingsValue,
  Task,
} from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Server-state hooks for the review-admin management surfaces (frontend PRD
 * F9 / work package FE-F9-REVIEW-ADMIN). Every hook consumes a declared
 * OpenAPI operation; mutations carry If-Match (row version). Admin-domain
 * objects change rarely — no live event feed exists for them, so mutations
 * invalidate their list/read keys directly. The Idempotency-Key header is
 * not declared for admin operations, so none is sent (migration contract
 * §16.6 records the header-vs-profile drift).
 */

const PAGE_LIMIT = 200;

function pageItems<T>(data: { items?: T[]; page?: { has_more: boolean } }): T[] {
  return data.items ?? [];
}

function ifMatch(version: number | undefined): Record<string, string> {
  // The frozen OpenAPI declares the Idempotency-Key header only on
  // order/query-domain mutations (profile-vs-header drift recorded in the
  // migration contract §16.6) — admin replacements carry If-Match only.
  return {
    "If-Match": `"${String(version ?? 1)}"`,
  };
}

// ---- datasources ---------------------------------------------------------

export function useDatasources(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "datasources"],
    queryFn: async () => {
      const response = await listDatasources({ limit: PAGE_LIMIT });
      return pageItems<Datasource>(response as unknown as { items?: Datasource[] });
    },
    enabled,
  });
}

export function useDatasourceCapabilities(datasourceId: string, probeKey: string, enabled: boolean) {
  return useQuery({
    // The probe key (the running/finished connection-test task id) makes a
    // re-test fetch fresh facts instead of replaying the previous ones —
    // the query only polls while the probe has not materialized data yet.
    queryKey: ["admin", "datasources", datasourceId, "capabilities", probeKey],
    queryFn: async () => {
      try {
        const response = await getDatasourceCapabilities(datasourceId);
        return response as unknown as DatasourceCapabilities;
      } catch (error) {
        // A missing probe (1002 before the first connection test) is the
        // empty state of this view, not a failure — the query keeps
        // polling until a probe materializes the capabilities.
        if (error instanceof BusinessError && error.err_code === businessErrCodeByName("RESOURCE_NOT_FOUND")) {
          return null;
        }
        throw error;
      }
    },
    enabled: enabled && datasourceId !== "",
    retry: false,
    refetchInterval: (queryInstance) => (queryInstance.state.data === null ? 800 : false),
  });
}

export function useCreateDatasource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (write: DatasourceWrite) => {
      const response = await createDatasource(write);
      return response as unknown as Datasource;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "datasources"] });
    },
  });
}

export function useReplaceDatasource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, write }: { id: string; version: number; write: DatasourceWrite }) => {
      const response = await replaceDatasource(id, write, { headers: ifMatch(version) });
      return response as unknown as Datasource;
    },
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "datasources"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "datasources", updated.id] });
    },
  });
}

export function useDeleteDatasource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await deleteDatasource(id, { headers: ifMatch(version) });
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "datasources"] });
    },
  });
}

export function useTestDatasourceConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, purpose }: { id: string; purpose: "review" | "query" | "execution" }) => {
      const response = await testDatasourceConnection(id, { purpose });
      return response as unknown as Task;
    },
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "tasks", task.id] });
    },
  });
}

export function useAdminTask(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "tasks", taskId],
    queryFn: async () => {
      const response = await getTask(taskId);
      return response as unknown as Task;
    },
    enabled: enabled && taskId !== "",
    // Terminal task states stop the polling; the capability refetch happens
    // through the succeeded-task effect on the page.
    refetchInterval: (queryInstance) => {
      const state = queryInstance.state.data?.state;
      return state === "queued" || state === "running" ? 500 : false;
    },
  });
}

// ---- ai providers ---------------------------------------------------------

export function useAiProviders(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "ai-providers"],
    queryFn: async () => {
      const response = await listAiProviders();
      // Declared bare array, selection_priority ascending — index 0 is the
      // primary provider (backend provider/chain.go:3).
      return response as unknown as AiProvider[];
    },
    enabled,
  });
}

export function useCreateAiProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (write: CreateAiProviderRequest) => {
      const response = await createAiProvider(write);
      return response as unknown as AiProvider;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
    },
  });
}

export function useReplaceAiProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, write }: { id: string; version: number; write: AiProviderWrite }) => {
      const response = await replaceAiProvider(id, write, { headers: ifMatch(version) });
      return response as unknown as AiProvider;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
    },
  });
}

export function useDeleteAiProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await deleteAiProvider(id, { headers: ifMatch(version) });
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai-providers"] });
    },
  });
}

export function useTestAiProviderConnection() {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await testAiProviderConnection(id);
      return response as unknown as Task;
    },
  });
}

// ---- settings --------------------------------------------------------------

export function useSettingsNamespace(namespace: "general" | "query" | "execution" | "ai-budget" | "branding", enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "settings", namespace],
    queryFn: async () => {
      const response = await getSettingsNamespace(namespace);
      return response as unknown as {
        namespace: string;
        schema_version: number;
        settings: SettingsValue;
        version: number;
        updated_by: string;
        updated_at: string;
      };
    },
    enabled,
  });
}

export function useSettingsRevisions(namespace: "general" | "query" | "execution" | "ai-budget" | "branding", enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "settings", namespace, "revisions"],
    queryFn: async () => {
      const response = await listSettingsRevisions(namespace, { limit: 50 });
      return pageItems<SettingsRevision>(response as unknown as { items?: SettingsRevision[] });
    },
    enabled,
  });
}

export function useAssessSettingsImpact() {
  return useMutation({
    mutationFn: async ({
      namespace,
      settings,
    }: {
      namespace: "general" | "query" | "execution" | "ai-budget" | "branding";
      settings: SettingsValue;
    }) => {
      const response = await assessSettingsImpact(namespace, { settings });
      return response as unknown as SettingsImpactAssessment;
    },
  });
}

export function useReplaceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      namespace,
      version,
      settings,
      impactToken,
    }: {
      namespace: "general" | "query" | "execution" | "ai-budget" | "branding";
      version: number;
      settings: SettingsValue;
      impactToken: string | null;
    }) => {
      const response = await replaceSettingsNamespace(
        namespace,
        { settings, impact_token: impactToken },
        { headers: ifMatch(version) },
      );
      return response as unknown as { version: number; settings: SettingsValue };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings", variables.namespace] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings", variables.namespace, "revisions"] });
    },
  });
}

// ---- prompt tools ----------------------------------------------------------

export function usePromptTools(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "prompt-tools"],
    queryFn: async () => {
      const response = await listPromptTools({ limit: PAGE_LIMIT });
      return pageItems<PromptTool>(response as unknown as { items?: PromptTool[] });
    },
    enabled,
  });
}

export function useCreatePromptTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (write: PromptToolWrite) => {
      const response = await createPromptTool(write);
      return response as unknown as PromptTool;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "prompt-tools"] });
    },
  });
}

export function useReplacePromptTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, write }: { id: string; version: number; write: PromptToolWrite }) => {
      const response = await replacePromptTool(id, write, { headers: ifMatch(version) });
      return response as unknown as PromptTool;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "prompt-tools"] });
    },
  });
}

export function useDeletePromptTool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await deletePromptTool(id, { headers: ifMatch(version) });
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "prompt-tools"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "rule-sets"] });
    },
  });
}

// ---- knowledge entries ------------------------------------------------------

export function useKnowledgeEntries(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "knowledge-entries"],
    queryFn: async () => {
      const response = await listKnowledgeEntries({ limit: PAGE_LIMIT });
      return pageItems<KnowledgeEntry>(response as unknown as { items?: KnowledgeEntry[] });
    },
    enabled,
  });
}

export function useCreateKnowledgeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (write: KnowledgeEntryWrite) => {
      const response = await createKnowledgeEntry(write);
      return response as unknown as KnowledgeEntry;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "knowledge-entries"] });
    },
  });
}

export function useReplaceKnowledgeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, write }: { id: string; version: number; write: KnowledgeEntryWrite }) => {
      const response = await replaceKnowledgeEntry(id, write, { headers: ifMatch(version) });
      return response as unknown as KnowledgeEntry;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "knowledge-entries"] });
    },
  });
}

export function useDeleteKnowledgeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await deleteKnowledgeEntry(id, { headers: ifMatch(version) });
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "knowledge-entries"] });
    },
  });
}

export function useEvaluateKnowledgeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await evaluateKnowledgeEntry(id);
      return response as unknown as KnowledgeEntryEvaluation;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "knowledge-entries"] });
    },
  });
}

// ---- rule sets ---------------------------------------------------------------

export function useRuleSets(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "rule-sets"],
    queryFn: async () => {
      const response = await listRuleSets({ limit: PAGE_LIMIT });
      return pageItems<RuleSet>(response as unknown as { items?: RuleSet[] });
    },
    enabled,
  });
}

export function useCreateRuleSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (write: RuleSetWrite) => {
      const response = await createRuleSet(write);
      return response as unknown as RuleSet;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "rule-sets"] });
    },
  });
}

export function useReplaceRuleSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, write }: { id: string; version: number; write: RuleSetWrite }) => {
      const response = await replaceRuleSet(id, write, { headers: ifMatch(version) });
      return response as unknown as RuleSet;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "rule-sets"] });
    },
  });
}

export function useDeleteRuleSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      await deleteRuleSet(id, { headers: ifMatch(version) });
      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "rule-sets"] });
    },
  });
}

/**
 * Flow list read for the rule-set impact preview: which change flows bind a
 * rule set (FlowWrite.rule_set_id). The binding itself happens on the flow
 * editor (F10) — this page only renders the reverse visibility.
 */
export function useFlowsForRuleSetImpact(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "flows", "rule-set-impact"],
    queryFn: async () => {
      const response = await listFlows({ limit: PAGE_LIMIT });
      return pageItems<{
        id: string;
        name: string;
        flow_type: string;
        enabled: boolean;
        rule_set_id: string | null;
      }>(response as unknown as { items?: Array<{ id: string; name: string; flow_type: string; enabled: boolean; rule_set_id: string | null }> });
    },
    enabled,
  });
}
