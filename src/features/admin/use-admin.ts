import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assessSettingsImpact,
  createAiProvider,
  createDatasource,
  createFlow,
  createIdentityProvider,
  createKnowledgeEntry,
  createNotificationChannel,
  createPermissionGroup,
  createPromptTool,
  createRuleSet,
  createUser,
  deleteAiProvider,
  deleteDatasource,
  deleteFlow,
  deleteIdentityProvider,
  deleteKnowledgeEntry,
  deleteNotificationChannel,
  deletePermissionGroup,
  deletePromptTool,
  deleteRuleSet,
  deleteUser,
  evaluateKnowledgeEntry,
  getDatasourceCapabilities,
  getSettingsNamespace,
  getUserDeletionImpact,
  listAiProviders,
  listAnnouncementRevisions,
  listAuditEvents,
  listDatasources,
  listFlows,
  listFlowMaskingRules,
  listIdentityProviders,
  listKnowledgeEntries,
  listNotificationChannels,
  listNotificationDeliveries,
  listPermissionGroups,
  listPromptTools,
  listRuleSets,
  listSettingsRevisions,
  listUsers,
  replaceAiProvider,
  replaceDatasource,
  replaceFlow,
  replaceIdentityProvider,
  replaceKnowledgeEntry,
  replaceNotificationChannel,
  replacePermissionGroup,
  replacePromptTool,
  replaceRuleSet,
  replaceSettingsNamespace,
  replaceFlowMaskingRule,
  testAiProviderConnection,
  testDatasourceConnection,
  testIdentityProviderConnection,
  updateUser,
} from "@/api/generated/client/administration/administration";
import {
  approveLegacyMigrationRun,
  confirmLegacyMigrationCandidate,
  getLegacyMigrationRun,
  listLegacyMigrationRuns,
} from "@/api/generated/client/administration/administration";
import {
  createAnnouncementRevision,
  publishAnnouncementRevision,
} from "@/api/generated/client/administration/administration";
import { getTask } from "@/api/generated/client/tasks/tasks";
import { BusinessError } from "@/shared/api/mutator";
import { businessErrCodeByName } from "@/shared/api/error-display";
import type {
  AiProvider,
  AiProviderWrite,
  AnnouncementRevision,
  AuditEvent,
  ConfirmLegacyMigrationCandidateRequest,
  CreateAiProviderRequest,
  CreateIdentityProviderRequest,
  CreateNotificationChannelRequest,
  NotificationChannelWrite,
  CreateUserRequest,
  Datasource,
  DatasourceCapabilities,
  DatasourceWrite,
  Flow,
  FlowMaskingRule,
  FlowMaskingRuleWrite,
  FlowWrite,
  IdentityProvider,
  KnowledgeEntry,
  KnowledgeEntryEvaluation,
  KnowledgeEntryWrite,
  LegacyMigrationCandidate,
  LegacyMigrationRun,
  NotificationChannel,
  NotificationDelivery,
  PermissionGroup,
  PromptTool,
  PermissionGroupWrite,
  PromptToolWrite,
  PublishAnnouncementRequest,
  ReplaceIdentityProviderRequest,
  RuleSet,
  RuleSetWrite,
  SettingsImpactAssessment,
  SettingsRevision,
  SettingsValue,
  Task,
  UpdateUserRequest,
  User,
  UserDeletionImpact,
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


// ===========================================================================
// FE-F10 site domains: users, permission groups, flows, masking rules,
// announcements, audit events, identity providers, notification channels
// and migration review runs. Mutations carry If-Match; the admin guard is
// the server's can_access_admin.
// ===========================================================================

// ---- users ---------------------------------------------------------------

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const response = await listUsers({ limit: PAGE_LIMIT });
      return pageItems<User>(response as unknown as { items?: User[] });
    },
    enabled,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateUserRequest) => {
      return (await createUser(body)) as unknown as User;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; version: number; body: UpdateUserRequest }) => {
      return (await updateUser(input.userId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as User;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; version: number }) => {
      await deleteUser(input.userId, { headers: ifMatch(input.version) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useDeletionImpact(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "users", userId, "deletion-impact"],
    queryFn: async () => {
      return (await getUserDeletionImpact(userId)) as unknown as UserDeletionImpact;
    },
    enabled: enabled && userId !== "",
  });
}

// ---- permission groups ---------------------------------------------------

export function usePermissionGroups(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "permission-groups"],
    queryFn: async () => {
      const response = await listPermissionGroups({ limit: PAGE_LIMIT });
      return pageItems<PermissionGroup>(
        response as unknown as { items?: PermissionGroup[] },
      );
    },
    enabled,
  });
}

export function useCreatePermissionGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PermissionGroupWrite) => {
      return (await createPermissionGroup(body)) as unknown as PermissionGroup;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "permission-groups"] });
    },
  });
}

export function useReplacePermissionGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; version: number; body: PermissionGroupWrite }) => {
      return (await replacePermissionGroup(input.groupId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as PermissionGroup;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "permission-groups"] });
    },
  });
}

export function useDeletePermissionGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; version: number }) => {
      await deletePermissionGroup(input.groupId, { headers: ifMatch(input.version) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "permission-groups"] });
    },
  });
}

// ---- flows (full model + masking rules) -----------------------------------

export function useFlows(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "flows"],
    queryFn: async () => {
      const response = await listFlows({ limit: PAGE_LIMIT });
      return pageItems<Flow>(response as unknown as { items?: Flow[] });
    },
    enabled,
  });
}

export function useCreateFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: FlowWrite) => {
      return (await createFlow(body)) as unknown as Flow;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "flows"] });
    },
  });
}

export function useReplaceFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { flowId: string; version: number; body: FlowWrite }) => {
      return (await replaceFlow(input.flowId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as Flow;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "flows"] });
    },
  });
}

export function useDeleteFlow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { flowId: string; version: number }) => {
      await deleteFlow(input.flowId, { headers: ifMatch(input.version) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "flows"] });
    },
  });
}

export function useFlowMaskingRules(flowId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "flows", flowId, "masking-rules"],
    queryFn: async () => {
      return (await listFlowMaskingRules(flowId)) as unknown as FlowMaskingRule[];
    },
    enabled: enabled && flowId !== "",
  });
}

export function useReplaceMaskingRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      flowId: string;
      datasourceId: string;
      body: FlowMaskingRuleWrite;
    }) => {
      return (await replaceFlowMaskingRule(input.flowId, input.datasourceId, input.body));
    },
    onSettled: (_data, error, variables) => {
      if (error === null) {
        void queryClient.invalidateQueries({
          queryKey: ["admin", "flows", variables.flowId, "masking-rules"],
        });
      }
    },
  });
}

// ---- announcements ---------------------------------------------------------

export function useAnnouncementRevisions(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: async () => {
      const response = await listAnnouncementRevisions({ limit: PAGE_LIMIT });
      return pageItems<AnnouncementRevision>(
        response as unknown as { items?: AnnouncementRevision[] },
      );
    },
    enabled,
  });
}

export function useCreateAnnouncementRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { title: string; markdown_source: string }) => {
      return (await createAnnouncementRevision(body)) as unknown as AnnouncementRevision;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
  });
}

export function usePublishAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { body: PublishAnnouncementRequest; publicationVersion: number }) => {
      return (await publishAnnouncementRevision(input.body, {
        headers: ifMatch(input.publicationVersion),
      })) as unknown as AnnouncementRevision;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
      void queryClient.invalidateQueries({ queryKey: ["announcements", "current"] });
    },
  });
}

// ---- audit events -----------------------------------------------------------

export function useAuditEvents(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "audit-events"],
    queryFn: async () => {
      const response = await listAuditEvents({ limit: PAGE_LIMIT });
      return pageItems<AuditEvent>(response as unknown as { items?: AuditEvent[] });
    },
    enabled,
  });
}

// ---- identity providers ------------------------------------------------------

export function useIdentityProviders(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "identity-providers"],
    queryFn: async () => {
      const response = await listIdentityProviders({ limit: PAGE_LIMIT });
      return pageItems<IdentityProvider>(
        response as unknown as { items?: IdentityProvider[] },
      );
    },
    enabled,
  });
}

export function useCreateIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateIdentityProviderRequest) => {
      return (await createIdentityProvider(body)) as unknown as IdentityProvider;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "identity-providers"] });
    },
  });
}

export function useReplaceIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; version: number; body: ReplaceIdentityProviderRequest }) => {
      return (await replaceIdentityProvider(input.providerId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as IdentityProvider;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "identity-providers"] });
    },
  });
}

export function useDeleteIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { providerId: string; version: number }) => {
      await deleteIdentityProvider(input.providerId, { headers: ifMatch(input.version) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "identity-providers"] });
    },
  });
}

export function useTestIdentityProviderConnection() {
  return useMutation({
    mutationFn: async (providerId: string) => {
      return (await testIdentityProviderConnection(providerId)) as unknown as Task;
    },
  });
}

// ---- notification channels ----------------------------------------------------

export function useNotificationChannels(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "notification-channels"],
    queryFn: async () => {
      const response = await listNotificationChannels({ limit: PAGE_LIMIT });
      return pageItems<NotificationChannel>(
        response as unknown as { items?: NotificationChannel[] },
      );
    },
    enabled,
  });
}

export function useNotificationDeliveries(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "notification-deliveries"],
    queryFn: async () => {
      const response = await listNotificationDeliveries({ limit: PAGE_LIMIT });
      return pageItems<NotificationDelivery>(
        response as unknown as { items?: NotificationDelivery[] },
      );
    },
    enabled,
  });
}

export function useCreateNotificationChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateNotificationChannelRequest) => {
      return (await createNotificationChannel(body)) as unknown as NotificationChannel;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "notification-channels"] });
    },
  });
}

export function useReplaceNotificationChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { channelId: string; version: number; body: NotificationChannelWrite }) => {
      return (await replaceNotificationChannel(input.channelId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as NotificationChannel;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "notification-channels"] });
    },
  });
}

export function useDeleteNotificationChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { channelId: string; version: number }) => {
      await deleteNotificationChannel(input.channelId, { headers: ifMatch(input.version) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "notification-channels"] });
    },
  });
}

export function useTestNotificationDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { channelId: string; body: unknown }) => {
      const { createNotificationTestDelivery } = await import(
        "@/api/generated/client/administration/administration"
      );
      return (await createNotificationTestDelivery(input.channelId, input.body as never)) as unknown as NotificationDelivery;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "notification-deliveries"] });
    },
  });
}

// ---- migration review ----------------------------------------------------------

export function useMigrationRuns(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "migrations"],
    queryFn: async () => {
      const response = await listLegacyMigrationRuns({ limit: PAGE_LIMIT });
      return pageItems<LegacyMigrationRun>(
        response as unknown as { items?: LegacyMigrationRun[] },
      );
    },
    enabled,
  });
}

export function useMigrationRun(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "migrations", runId],
    queryFn: async () => {
      return (await getLegacyMigrationRun(runId)) as unknown as LegacyMigrationRun;
    },
    enabled: enabled && runId !== "",
  });
}

export function useConfirmMigrationCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      runId: string;
      candidateId: string;
      version: number;
      body: ConfirmLegacyMigrationCandidateRequest;
    }) => {
      return (await confirmLegacyMigrationCandidate(input.runId, input.candidateId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as LegacyMigrationCandidate;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "migrations"] });
    },
  });
}

export function useApproveMigrationRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      runId: string;
      version: number;
      body: { manifest_hash: string; confirmation_phrase: string };
    }) => {
      return (await approveLegacyMigrationRun(input.runId, input.body, {
        headers: ifMatch(input.version),
      })) as unknown as LegacyMigrationRun;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "migrations"] });
    },
  });
}
