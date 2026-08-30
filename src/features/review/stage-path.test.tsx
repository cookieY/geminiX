import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Flow } from "@/api/generated/client/yearningV4HTTPAPI.schemas";
import "@/shared/i18n";
import { StagePath } from "./stage-path";

/**
 * The stage path shows the frozen flow chain. Datasource display names are
 * not exposed to submitters by the API (listDatasources is admin-scoped), so
 * the path renders stage positions only — server identifiers, not guessed
 * names.
 */

function flow(stages: number): Flow {
  return {
    id: "4f6f1a2b-0000-4000-8000-000000000001",
    name: "默认审核流程",
    flow_type: "change_review",
    enabled: true,
    stages: Array.from({ length: stages }, (_, index) => ({
      position: index + 1,
      datasource_id: "4f6f1a2b-0000-4000-8000-00000000000" + String(index + 2),
      schema_mappings: [],
      approval_steps: [],
      execution_actors: [],
    })),
    version: 1,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
  };
}

describe("StagePath", () => {
  it("renders every stage position in order", () => {
    render(<StagePath flow={flow(3)} />);
    const path = screen.getByTestId("stage-path");
    expect(path.textContent).toContain("阶段 1");
    expect(path.textContent).toContain("阶段 2");
    expect(path.textContent).toContain("阶段 3");
  });

  it("explains when no flow information exists", () => {
    render(<StagePath flow={null} />);
    expect(screen.getByText("暂无流程信息")).toBeInTheDocument();
  });
});
