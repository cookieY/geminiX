#!/usr/bin/env node
// Generates the three contract projection outputs under src/api/generated/projections/
// from the shared YearningX contracts (code-generation-policy.json
// contract_projection_outputs). Deterministic: same contract bytes produce
// byte-identical output. Run as part of `pnpm api:generate`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..");
const yearningRoot = resolve(frontendRoot, "..");

const read = (p) => JSON.parse(readFileSync(resolve(yearningRoot, p), "utf8"));
const errorCodes = read("api/contracts/error-codes.json");
const profiles = read("api/contracts/operation-error-profiles.json");
const stateMachines = read("api/contracts/state-machines.json");

const header = (source) =>
  `// GENERATED FILE — do not edit by hand.\n` +
  `// Source: ${source} (hash-bound in src/api/generated/contract-manifest.json)\n` +
  `// Regenerate with: pnpm api:generate\n`;

mkdirSync(resolve(frontendRoot, "src/api/generated/projections"), { recursive: true });

// 1. business-error-catalog.ts — err_code constants and catalog from error-codes.json.
{
  const errors = Object.fromEntries(
    errorCodes.business_errors.map((e) => [
      String(e.err_code),
      { name: e.name, retryability: e.retryability, domain: e.domain },
    ]),
  );
  const body =
    header("api/contracts/error-codes.json") +
    `export const SUCCESS_ERR_CODE: number = ${JSON.stringify(errorCodes.success_err_code)};\n\n` +
    `export const BUSINESS_HTTP_STATUS: number = ${JSON.stringify(errorCodes.business_http_status)};\n\n` +
    `export interface BusinessErrorCatalogEntry {\n  name: string;\n  retryability: string;\n  domain: string;\n}\n\n` +
    `export const BUSINESS_ERROR_CATALOG: {\n  errors: Record<string, BusinessErrorCatalogEntry>;\n} = {\n  errors: ${JSON.stringify(errors, null, 2)},\n} as const;\n`;
  writeFileSync(resolve(frontendRoot, "src/api/generated/projections/business-error-catalog.ts"), body);
}

// 2. operation-error-profiles.ts — exhaustive per-operation declared err_codes.
// Profiles reference errors by stable name in the contract; resolve them to the
// numeric err_code the frontend actually compares against.
{
  const codeByName = new Map(
    errorCodes.business_errors.map((e) => [e.name, e.err_code]),
  );
  const profileOfOperation = new Map();
  for (const assignment of profiles.assignments) {
    for (const operationId of assignment.operations) {
      profileOfOperation.set(operationId, assignment.profile);
    }
  }
  const resolveOrThrow = (name, profile) => {
    const code = codeByName.get(name);
    if (code === undefined) {
      throw new Error(`operation-error-profiles: profile ${profile} references unknown error name ${name}`);
    }
    return code;
  };
  const entries = Object.fromEntries(
    Object.entries(profiles.profiles).map(([profile, errNames]) => {
      const codes = errNames.map((name) => resolveOrThrow(name, profile));
      const operations = [...profileOfOperation.entries()]
        .filter(([, p]) => p === profile)
        .map(([op]) => op);
      return [profile, { err_codes: codes, operations }];
    }),
  );
  const body =
    header("api/contracts/operation-error-profiles.json") +
    `export interface OperationErrorProfile {\n  err_codes: number[];\n  operations: string[];\n}\n\n` +
    `export const OPERATION_ERROR_PROFILES: {\n  profiles: Record<string, OperationErrorProfile>;\n  semantics: {\n    unlistedBusinessErrorIsContractViolation: boolean;\n  };\n} = {\n  profiles: ${JSON.stringify(entries, null, 2)},\n  semantics: {\n    unlistedBusinessErrorIsContractViolation: ${JSON.stringify(
      profiles.semantics.unlisted_business_error_for_operation === "contract_violation",
    )},\n  },\n} as const;\n`;
  writeFileSync(resolve(frontendRoot, "src/api/generated/projections/operation-error-profiles.ts"), body);
}

// 3. state-display-projection.ts — state machine states as display tokens.
{
  const machines = Object.fromEntries(
    Object.entries(stateMachines.machines).map(([name, machine]) => [
      name,
      {
        initial: machine.initial,
        states: machine.states,
        terminal: machine.terminal,
      },
    ]),
  );
  const body =
    header("api/contracts/state-machines.json") +
    `export interface StateMachineProjection {\n  initial: string;\n  states: string[];\n  terminal: string[];\n}\n\n` +
    `export const STATE_DISPLAY_PROJECTION: {\n  machines: Record<string, StateMachineProjection>;\n} = {\n  machines: ${JSON.stringify(machines, null, 2)},\n} as const;\n`;
  writeFileSync(resolve(frontendRoot, "src/api/generated/projections/state-display-projection.ts"), body);
}

console.log("projections: business-error-catalog.ts, operation-error-profiles.ts, state-display-projection.ts written");
