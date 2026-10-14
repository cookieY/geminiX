import { create } from "zustand";

/**
 * Mock identity dimension (owner ruling 2026-10-13 on issue #1/§18.44): the
 * single-account demo collapsed submitter, frozen reviewers and executors
 * into one user, so the submitter's own order detail grew the approval
 * decision card. The mock now models three deterministic identities, read
 * per request exactly like the auth-behavior and scenario dimensions:
 * henry submits (and owns the seeded drafts), reviewer-a holds every frozen
 * approval-step actor slot, executor-a holds every execution-actor slot.
 */
export type MockIdentity = "henry" | "reviewer-a" | "executor-a";

export interface MockIdentityUser {
  id: string;
  username: string;
}

export const MOCK_IDENTITIES: Record<MockIdentity, MockIdentityUser> = {
  henry: { id: "0198d9cc-e65d-7b9d-a8aa-3c81945f99ac", username: "henry" },
  "reviewer-a": { id: "0198d9cc-e65d-7b9d-a8aa-3c81945fa001", username: "reviewer-a" },
  "executor-a": { id: "0198d9cc-e65d-7b9d-a8aa-3c81945fb002", username: "executor-a" },
};

/** Stable role-slot ids for fixture seeding (frozen snapshots and flow
 * templates). Submitter stays the henry identity. */
export const MOCK_IDENTITY_IDS = {
  submitter: MOCK_IDENTITIES.henry.id,
  reviewer: MOCK_IDENTITIES["reviewer-a"].id,
  executor: MOCK_IDENTITIES["executor-a"].id,
} as const;

const STORAGE_KEY = "yearning-mock-identity";

export function readStoredIdentity(): MockIdentity {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "reviewer-a" || value === "executor-a" ? value : "henry";
}

/** Identity of the current session, read per request so tests and the e2e
 * helper can flip it without re-mounting the worker or re-logging-in. */
export function currentIdentity(): MockIdentityUser {
  return MOCK_IDENTITIES[readStoredIdentity()];
}

export function currentIdentityId(): string {
  return currentIdentity().id;
}

/** Username for a known fixture identity id — frozen actor snapshots and
 * execution-actor lists render names; unknown ids fall back to "henry". */
export function identityUsernameOf(userId: string): string {
  const found = Object.values(MOCK_IDENTITIES).find((identity) => identity.id === userId);
  return found?.username ?? "henry";
}

export const useMockIdentity = create<{ identity: MockIdentity }>(() => ({
  identity: "henry",
}));

export function setMockIdentity(identity: MockIdentity): void {
  localStorage.setItem(STORAGE_KEY, identity);
  useMockIdentity.setState({ identity });
  window.dispatchEvent(new CustomEvent("yearning:mock-identity"));
}
