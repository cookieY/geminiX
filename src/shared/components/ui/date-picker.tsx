import { useTranslation } from "react-i18next";
import { CalendarIcon } from "lucide-react";
import type { Locale } from "react-day-picker";
import { enUS, zhCN } from "react-day-picker/locale";

import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

/** Local-date helpers: filter values are plain YYYY-MM-DD strings; constructing
 * through the local clock keeps the picked day stable across timezones. */
function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * shadcn-style date picker (owner ruling 2026-09-02): a popover calendar
 * replaces the native date input so the filter bar matches the design
 * baseline. Controlled by a plain YYYY-MM-DD string ("" = no selection).
 */
export function DatePicker({
  value,
  onChange,
  placeholder,
  ariaLabel,
  testId,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}) {
  const { i18n } = useTranslation();
  const locale: Locale = i18n.language?.startsWith("zh") ? zhCN : enUS;
  const selected = value === "" ? undefined : parseLocalDate(value);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            data-testid={testId}
            className={cn(
              "h-8 w-36 justify-start gap-2 px-2.5 text-left text-xs font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="size-4" aria-hidden />
            {value === "" ? (placeholder ?? "--/--/----") : formatLocalDate(selected as Date)}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(day) => {
            onChange(day === undefined ? "" : formatLocalDate(day));
          }}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  );
}
