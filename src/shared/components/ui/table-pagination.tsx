import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

const SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * Backend-paging footer for list tables (owner ruling 2026-09-02, reference
 * image): Previous/Next on the left, the page counter in the center, and the
 * rows-per-page picker on the right. The backend pages by cursor (PageInfo:
 * next_cursor/has_more) so there is no total — the counter shows the current
 * page walk and Next is gated by has_more.
 */
export function TablePagination({
  page,
  hasMore,
  isFirst,
  onPrev,
  onNext,
  pageSize,
  onPageSizeChange,
  testIdPrefix,
}: {
  page: number;
  hasMore: boolean;
  isFirst: boolean;
  onPrev: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-row items-center justify-between gap-3 pt-2"
      data-testid={`${testIdPrefix}-pagination`}
    >
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isFirst} onClick={onPrev}>
          {t("table.pagination.prev")}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={onNext}>
          {t("table.pagination.next")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" data-testid={`${testIdPrefix}-page`}>
        {t("table.pagination.page", { page })}
      </p>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {t("table.pagination.rowsPerPage")}
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            if (value) onPageSizeChange(Number(value));
          }}
        >
          <SelectTrigger
            className="h-7 w-[72px]"
            aria-label={t("table.pagination.rowsPerPage")}
            data-testid={`${testIdPrefix}-page-size`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {String(size)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
