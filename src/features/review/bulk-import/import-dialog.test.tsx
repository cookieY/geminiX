import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/shared/i18n";
import { ImportDialog } from "@/features/review/bulk-import/import-dialog";
import { FINGERPRINT_MAX_INPUT_BYTES } from "@/features/review/bulk-constants";

/**
 * Import dialog pre-validation (frontend PRD F5 item 7): hard blocks on the
 * 32 MiB file and 512 KiB statement limits before any upload, incremental
 * read progress, cancel — and the confirm path hands exactly one SQL copy to
 * the page. The server remains the final judgement.
 */

function sqlFile(content: string, name = "bulk.sql"): File {
  return new File([content], name, { type: "text/plain" });
}

function pickFile(file: File): void {
  const input = screen.getByTestId("bulk-import-input");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("ImportDialog", () => {
  it("reads a small file and reaches the ready summary", async () => {
    const onConfirm = vi.fn();
    render(<ImportDialog open onOpenChange={() => {}} onConfirm={onConfirm} />);
    pickFile(sqlFile("SELECT 1;\nSELECT 2;\n"));
    await waitFor(() => {
      expect(screen.getByTestId("bulk-import-ok")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-summary-statements")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("bulk-import-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toBe("SELECT 1;\nSELECT 2;\n");
  });

  it("blocks files above the 32 MiB limit without reading them", async () => {
    render(<ImportDialog open onOpenChange={() => {}} onConfirm={vi.fn()} />);
    const huge = new File([], "huge.sql");
    Object.defineProperty(huge, "size", { value: FINGERPRINT_MAX_INPUT_BYTES + 1 });
    pickFile(huge);
    await waitFor(() => {
      expect(screen.getByTestId("bulk-import-block-fileTooLarge")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bulk-import-confirm")).toBeDisabled();
  });

  it("blocks imports containing an oversized statement", async () => {
    render(<ImportDialog open onOpenChange={() => {}} onConfirm={vi.fn()} />);
    const big = `UPDATE t SET payload = '${"x".repeat(530000)}' WHERE id = 1;\nSELECT 1;\n`;
    pickFile(sqlFile(big));
    await waitFor(() => {
      expect(screen.getByTestId("bulk-import-block-statementTooLarge")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bulk-import-confirm")).toBeDisabled();
  });

  it("cancels a long read and offers a clean retry", async () => {
    render(<ImportDialog open onOpenChange={() => {}} onConfirm={vi.fn()} />);
    // ~10 MiB → ten chunk iterations, each yielding to the event loop, so the
    // cancel click lands squarely inside the reading window.
    const body = "SELECT 1;\n".repeat(1000000);
    pickFile(sqlFile(body));
    await waitFor(() => {
      expect(screen.getByTestId("bulk-import-cancel")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("bulk-import-cancel"));
    await waitFor(() => {
      expect(screen.getByTestId("bulk-import-cancelled")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bulk-import-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("bulk-import-again"));
    expect(screen.queryByTestId("bulk-import-cancelled")).not.toBeInTheDocument();
  }, 10000);

  it("warns on an unterminated trailing statement but stays confirmable", async () => {
    render(<ImportDialog open onOpenChange={() => {}} onConfirm={vi.fn()} />);
    pickFile(sqlFile("SELECT 1;\nSELECT 2"));
    await waitFor(() => {
      expect(screen.getByText("最后一条语句未以分号结束")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bulk-import-confirm")).toBeEnabled();
  });
});
