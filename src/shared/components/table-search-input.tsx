import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/shared/components/ui/input";

/**
 * Shared table search box (owner request 2026-09-04, §18.37): filters the
 * table rows client-side by name substring. Renders with a leading search
 * icon and a clear affordance once text is entered.
 */
export function TableSearchInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full max-w-xs">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => { onChange(event.target.value); }}
        placeholder={placeholder ?? t("table.searchPlaceholder")}
        className="pr-8 pl-9"
        data-testid={testId}
      />
      {value !== "" && (
        <button
          type="button"
          aria-label={t("common.clear")}
          onClick={() => { onChange(""); }}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
          data-testid={`${testId}-clear`}
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
