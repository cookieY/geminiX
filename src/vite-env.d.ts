/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Yearning API; empty string means same-origin deployment. */
  readonly VITE_API_BASE_URL?: string;
  /** Enables the MSW browser worker for mock-driven development and e2e. */
  readonly VITE_ENABLE_MOCK?: string;
}

/** GitHub releases/latest endpoint, inlined by the vite.config.ts define.
 * Dev/production hit the real cookieY/Yearning releases API; the e2e web
 * server overrides it with a same-origin MSW fixture path so tests never
 * leave localhost. */
declare const __RELEASE_LATEST_URL__: string;

/** Owner-mandated footer links, inlined by the vite.config.ts define. */
declare const __SPONSOR_URL__: string;
declare const __DOCS_URL__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
