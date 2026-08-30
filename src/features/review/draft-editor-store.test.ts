import { beforeEach, describe, expect, it } from "vitest";
import { selectDirty, useDraftEditorStore } from "./draft-editor-store";

function reset() {
  useDraftEditorStore.getState().reset();
}

describe("draft editor store", () => {
  beforeEach(reset);

  it("attaches a fresh draft with no SQL", () => {
    useDraftEditorStore.getState().attach({
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
      state: "draft",
      revision: 1,
      sql: null,
    });
    const state = useDraftEditorStore.getState();
    expect(state.sql).toBe("");
    expect(selectDirty(state)).toBe(false);
  });

  it("marks the draft dirty the moment the editor text diverges", () => {
    useDraftEditorStore.getState().attach({
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
      state: "ready",
      revision: 3,
      sql: "SELECT 1",
    });
    expect(selectDirty(useDraftEditorStore.getState())).toBe(false);
    useDraftEditorStore.getState().setSql("SELECT 1 -- touched");
    expect(selectDirty(useDraftEditorStore.getState())).toBe(true);
  });

  it("saving realigns the delta and records the new revision", () => {
    useDraftEditorStore.getState().attach({
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
      state: "draft",
      revision: 1,
      sql: null,
    });
    useDraftEditorStore.getState().setSql("UPDATE t SET a = 1");
    expect(selectDirty(useDraftEditorStore.getState())).toBe(true);
    useDraftEditorStore.getState().markSaved(2, "outdated", "UPDATE t SET a = 1");
    const state = useDraftEditorStore.getState();
    expect(state.savedRevision).toBe(2);
    expect(state.serverState).toBe("outdated");
    expect(selectDirty(state)).toBe(false);
  });

  it("server state updates arrive without touching the editor text", () => {
    useDraftEditorStore.getState().attach({
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
      state: "reviewing",
      revision: 2,
      sql: "SELECT 1",
    });
    useDraftEditorStore.getState().markServerState("ready");
    const state = useDraftEditorStore.getState();
    expect(state.serverState).toBe("ready");
    expect(state.sql).toBe("SELECT 1");
    expect(selectDirty(state)).toBe(false);
  });

  it("reset clears everything including the in-memory plaintext", () => {
    useDraftEditorStore.getState().attach({
      id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac",
      state: "draft",
      revision: 1,
      sql: "SELECT secret",
    });
    useDraftEditorStore.getState().reset();
    const state = useDraftEditorStore.getState();
    expect(state.draftId).toBeNull();
    expect(state.sql).toBe("");
    expect(state.savedSql).toBeNull();
  });
});
