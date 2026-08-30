import { defineConfig } from "orval";
import { addItemsToBareArrays } from "./scripts/orval-transformer";

// Deterministic OpenAPI generation per api/development/code-generation-policy.json.
// All outputs derive from the single shared contract into pairwise-disjoint
// trees under src/api/generated/; the projections and contract-manifest.json
// are produced by scripts/generate-*.mjs in the api:generate chain.
// The fetch client plus the shared mutator is orval 8's custom-instance form:
// every request goes through src/shared/api/mutator.ts (err_code unwrapping).
const shared = {
  input: {
    target: "../api/openapi/yearning-v4.yaml",
    // Bridge OpenAPI 3.1 itemless-array semantics for the orval 8.27 zod
    // generator; see scripts/orval-transformer.ts. Faithful translation,
    // zero contract change.
    override: {
      transformer: addItemsToBareArrays,
    },
  },
};

const mutator = {
  path: "./src/shared/api/mutator.ts",
  name: "customInstance",
};

export default defineConfig({
  client: {
    ...shared,
    output: {
      target: "./src/api/generated/client",
      mode: "tags-split",
      client: "fetch",
      clean: true,
      mock: {
        path: "./src/api/generated/mocks",
        generators: [{ type: "msw", delay: false }],
      },
      override: {
        mutator,
      },
    },
  },
  zod: {
    ...shared,
    output: {
      target: "./src/api/generated/zod",
      mode: "split",
      client: "zod",
      clean: true,
    },
  },
  hooks: {
    ...shared,
    output: {
      target: "./src/api/generated/hooks",
      mode: "tags-split",
      client: "react-query",
      clean: true,
      override: {
        mutator,
        query: {
          useQuery: true,
          useMutation: true,
        },
      },
    },
  },
});
