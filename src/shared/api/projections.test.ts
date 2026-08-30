import { describe, expect, it } from "vitest";
import { STATE_DISPLAY_PROJECTION } from "@/api/generated/projections/state-display-projection";
import { OPERATION_ERROR_PROFILES } from "@/api/generated/projections/operation-error-profiles";
import { BUSINESS_ERROR_CATALOG, SUCCESS_ERR_CODE } from "@/api/generated/projections/business-error-catalog";

// The projections are generated outputs; these tests assert the contract facts
// the frontend relies on so a silent contract change cannot pass unnoticed.
describe("generated contract projections", () => {
  it("exposes the success err_code from error-codes.json", () => {
    expect(SUCCESS_ERR_CODE).toBe(0);
  });

  it("covers every declared business error with stable identifiers", () => {
    const entries = Object.values(BUSINESS_ERROR_CATALOG.errors);
    expect(entries.length).toBeGreaterThanOrEqual(60);
    for (const entry of entries) {
      expect(entry.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(["never", "safe", "contextual"]).toContain(entry.retryability);
    }
  });

  it("treats unlisted business errors as contract violations", () => {
    expect(OPERATION_ERROR_PROFILES.semantics.unlistedBusinessErrorIsContractViolation).toBe(true);
  });

  it("binds every error profile to at least one operation with numeric codes", () => {
    const profiles = Object.values(OPERATION_ERROR_PROFILES.profiles);
    expect(profiles.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      for (const code of profile.err_codes) {
        expect(BUSINESS_ERROR_CATALOG.errors[String(code)]).toBeTruthy();
      }
    }
  });

  it("projects every state machine with initial, states and terminal subsets", () => {
    const machines = Object.entries(STATE_DISPLAY_PROJECTION.machines);
    expect(machines.length).toBeGreaterThanOrEqual(6);
    for (const [name, machine] of machines) {
      expect(machine.states).toContain(machine.initial);
      for (const terminal of machine.terminal) {
        expect(machine.states).toContain(terminal);
      }
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
