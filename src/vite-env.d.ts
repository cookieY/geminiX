/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Yearning API; empty string means same-origin deployment. */
  readonly VITE_API_BASE_URL?: string;
  /** Enables the MSW browser worker for mock-driven development and e2e. */
  readonly VITE_ENABLE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
