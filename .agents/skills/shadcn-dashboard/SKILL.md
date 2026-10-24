---
name: shadcn-dashboard
description: Official Shadcn Dashboard registry discovery and audited component workflow.
---

# Shadcn Dashboard Assistant Skill

You are equipped with the `shadcndashboard-mcp` server. Your goal is to help the user discover, install, and integrate Shadcn Dashboard UI blocks.

Follow this strict workflow when asked to create or modify UI:

1. **Verify Project Setup & components.json (CRITICAL PRE-REQUISITE)**:
   - Check if `components.json` exists in the project root.
   - If `components.json` is missing, initialize shadcn first before installing any blocks:
     - Run: `npx shadcn@latest init` (or the project's detected package manager equivalent).
     - Ensure the style selected in `components.json` is `"base"` (Shadcn Dashboard blocks use the `"base"` style).

2. **Dashboard Shell Priority Rule (CRITICAL)**:
   - When asked to create or build any dashboard page or dashboard layout:
     - You **MUST FIRST** search for and use pre-built **Dashboard & Application Shells** (specifically `dashboard-shell-01` through `dashboard-shell-08`, or `application-shell-01` / `application-shell-02`) using `searchBlocks(query: "dashboard-shell")` or `listBlocks(category: "shells")` rather than manually assembling individual cards, sidebars, headers, and tables from scratch.
     - Always install one of these foundation shell blocks first to serve as the layout baseline.
     - Only add individual smaller blocks/components *inside* the established shell layout structure.

3. **Check Package Manager**:
   - Check the project's root directory for lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`) to determine the correct package manager (`npx`, `pnpm dlx`, `yarn dlx`, or `bunx --bun`).
   - If no lockfile is found, default to `npx`.

4. **Discover Free vs PRO Blocks**:
   - Every block includes an `isPro` boolean:
     - `isPro: false`: **100% Free** block. No license or token required.
     - `isPro: true`: **PRO** block requiring a license.
   - If the user has not specified a PRO license or asks for free components:
     - Use `listFreeBlocks` or pass `tier: "free"` to `listBlocks` or `searchBlocks`.
   - You can filter blocks by category using `category`: `"shells"`, `"charts"`, `"metrics"`, `"tables"`, `"forms"`, `"layout"`, or `"ai-ops"`.

5. **Retrieve Installation Commands & Import Specs**:
   - Once a block is identified, use the `getBlockInstall` tool to fetch the official installation command, component export name, import path, and clean JSX usage snippet.
   - Always pass the `packageManager` parameter you detected in step 3.
   - *Never* try to guess the code or hallucinate the component implementation.

6. **Install & License Handling**:
   - Execute the installation command returned by `getBlockInstall` in the terminal using the correct package manager executor.
   - If installing a PRO block fails requiring a license, call `handleError(errorType: "license", componentName: "...")` to receive recovery instructions.

7. **Grid Layout & Alignment Guidelines (CRITICAL)**:
   - Call `getDashboardLayoutGuidelines` whenever assembling components into layout grids.
   - Follow strict layout and height-balancing rules:
     - Side-by-side cards must match heights using `h-full` or flex/grid stretch wrappers.
     - Asymmetric/different height cards must be vertically stacked inside flex column containers to prevent broken layout gaps.

8. **Integration & Customization**:
   - Integrate the installed component into the user's page using the `importStatement` and `usageExample` provided by `getBlockInstall`.
   - You may safely modify visible text (headings, paragraphs, button labels).
   - Do NOT modify the component's internal logic, hooks, or complex styling unless explicitly instructed by the user.

9. **Existing Blocks**:
   - If you need to check what is already installed in the project, use `listInstalledBlocks`.
