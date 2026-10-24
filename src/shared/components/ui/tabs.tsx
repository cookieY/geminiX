"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/shared/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  // Reference ruling 2026-10-24 (tabs-02 block): the default tabs are pill
  // buttons in a transparent row — no segmented-control track; the active
  // pill carries the fill.
  "group/tabs-list inline-flex w-fit items-center justify-center gap-1 rounded-md text-muted-foreground group-data-vertical/tabs:flex-col data-[variant=line]:rounded-md data-[variant=line]:p-[3px] data-[variant=line]:group-data-horizontal/tabs:h-8 data-[variant=line]:bg-muted",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // Pill trigger (tabs-02 reference): house button metrics, quiet
        // inactive state, solid primary fill when active. The line variant
        // keeps its underline treatment and must not pick up the pill.
        // The dark-mode quiet/hover utilities are guarded with
        // not-data-active — unguarded they override the active pill's
        // primary-foreground text (dark text on the light dark-theme
        // primary) and white-on-white the label (owner bug report
        // 2026-10-24: label invisible while the cursor rests on the
        // clicked tab).
        "relative inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-0 text-sm font-medium whitespace-nowrap text-foreground/70 transition-[color,background-color,border-color,box-shadow,opacity] duration-100 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start not-data-active:hover:bg-muted not-data-active:hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:not-data-active:text-muted-foreground dark:not-data-active:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-primary data-active:text-primary-foreground data-active:hover:bg-primary/90 data-active:hover:text-primary-foreground dark:data-active:bg-primary dark:data-active:text-primary-foreground group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-xs/relaxed outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
