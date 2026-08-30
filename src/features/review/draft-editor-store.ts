import { create } from "zustand";
import type { DraftState } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

/**
 * Pure client-side editor state for one draft workspace session (frontend
 * PRD §4: Zustand for draft editing and cross-component client state; server
 * state stays in the Query layer). The SQL plaintext lives in memory only —
 * never in web storage, URLs or logs (migration contract §6). The store
 * tracks the delta between the editor text and the last saved revision so
 * the workspace can void a prior review result the instant the SQL changes
 * (PRD F4: SQL变化后立即本地标记outdated) instead of waiting for the PUT.
 */

interface DraftEditorState {
  draftId: string | null;
  /** Mirror of the server-side draft state from the latest query/mutation. */
  serverState: DraftState | null;
  /** Last revision acknowledged by PUT /sql or the draft query. */
  savedRevision: number | null;
  /** Editor text as of that revision (memory only). */
  savedSql: string | null;
  /** Current editor text (memory only). */
  sql: string;
  attach: (draft: { id: string; state: DraftState; revision: number; sql?: string | null }) => void;
  setSql: (sql: string) => void;
  markSaved: (revision: number, state: DraftState, sql: string) => void;
  markServerState: (state: DraftState) => void;
  reset: () => void;
}

const initial = {
  draftId: null,
  serverState: null,
  savedRevision: null,
  savedSql: null,
  sql: "",
} as const;

export const useDraftEditorStore = create<DraftEditorState>((set) => ({
  ...initial,
  attach: ({ id, state, revision, sql }) => { set({
      draftId: id,
      serverState: state,
      savedRevision: revision,
      savedSql: typeof sql === "string" ? sql : null,
      sql: typeof sql === "string" ? sql : "",
    }); },
  setSql: (sql) => { set({ sql }); },
  markSaved: (revision, state, sql) => { set({ savedRevision: revision, serverState: state, savedSql: sql, sql }); },
  markServerState: (state) => { set({ serverState: state }); },
  reset: () => { set({ ...initial }); },
}));

export function selectDirty(state: DraftEditorState): boolean {
  if (state.draftId === null) return false;
  // An attached draft whose saved SQL is unknown (never revealed in this
  // session) counts as clean until the user edits — there is no delta to
  // prove otherwise.
  if (state.savedSql === null) return state.sql !== "";
  return state.sql !== state.savedSql;
}
