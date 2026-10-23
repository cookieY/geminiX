import * as React from "react"

import { cn } from "@/shared/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      // `overflow-y: clip` instead of the implicit `auto`: rows are translated
      // during a FLIP reorder and an auto/scroll pairing would flash a
      // scrollbar (reflowing the table width) on every 200ms animation.
      className="relative w-full overflow-x-auto overflow-y-clip"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom text-xs",
          // Rows arrive with the table once the query resolves; 200ms carries
          // the swap without delaying reading.
          "animate-in fade-in-0 duration-200 ease-out",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({
  className,
  stale = false,
  ...props
}: React.ComponentProps<"tbody"> & { stale?: boolean }) {
  return (
    <tbody
      data-slot="table-body"
      // While a keepPreviousData page is being replaced the rows on screen are
      // stale: mark them busy and make them inert so a click cannot act on the
      // previous page's row. The fetch is usually short; the footer keeps the
      // 100ms busy dot visible.
      aria-busy={stale || undefined}
      className={cn(
        "[&_tr:last-child]:border-0",
        stale && "pointer-events-none",
        className,
      )}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors duration-100 ease-out hover:bg-muted/50 has-aria-expanded:bg-muted/50 active:bg-muted/70 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
