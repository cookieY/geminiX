"use client"

import { DayPicker, type DayPickerProps } from "react-day-picker"

import { cn } from "@/shared/lib/utils"

/**
 * Calendar on top of react-day-picker, styled per the frozen design baseline
 * (square corners, token colors) — the shadcn/ui Calendar pattern.
 */
function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-2",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonBase,
          "absolute left-1 top-1",
        ),
        button_next: cn(
          buttonBase,
          "absolute right-1 top-1",
        ),
        month_caption: "flex h-7 w-full items-center justify-center",
        caption_label: "text-sm font-medium",
        dropdowns: "flex items-center gap-1",
        dropdown: cn(
          buttonBase,
          "flex h-7 items-center justify-center gap-1 text-sm font-medium px-2",
        ),
        month_grid: "mt-4 border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-muted-foreground font-normal text-xs",
        week: "flex mt-1",
        day: "relative w-9 h-8 text-center text-sm",
        day_button: cn(
          buttonBase,
          "size-8 p-0 font-normal aria-selected:opacity-100",
        ),
        range_start: "relative",
        range_end: "relative",
        selected: cn(
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground",
        ),
        today: "rounded-md border border-border",
        outside: "day-outside text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  )
}

const buttonBase =
  "inline-flex size-7 items-center justify-center gap-1 p-0 text-xs font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"

export { Calendar }
