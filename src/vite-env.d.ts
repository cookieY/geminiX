/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Yearning API; empty string means same-origin deployment. */
  readonly VITE_API_BASE_URL?: string;
  /** Enables the MSW browser worker for mock-driven development and e2e. */
  readonly VITE_ENABLE_MOCK?: string;
}

/** GitHub releases/latest endpoint, inlined by the vite.config.ts define.
 * Mock/e2e builds get a same-origin MSW fixture path so tests never leave
 * localhost; production builds get the upstream GitHub API URL. */
declare const __RELEASE_LATEST_URL__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
