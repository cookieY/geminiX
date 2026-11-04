"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/components/ui/button"
import { ScrollArea } from "@/shared/components/ui/scroll-area"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/40 duration-150 ease-out data-open:animate-in data-open:fade-in-0 data-open:duration-[180ms] data-closed:animate-out data-closed:fade-out-0 data-closed:duration-[120ms]",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          /* 滚动条统一（owner 2026-11-03）：面板改为flex列并内嵌ScrollArea，
             内容超高时用覆盖式thumb滚动，不再由调用点传overflow-y-auto露原
             生条。高度帽放在viewport上而不是面板/root上：auto高度链里的
             height:100%会退化为auto（见scroll-area.tsx注释），只有viewport
             自身的max-h能可靠夹紧。gap-4随内容移入内层。
             owner 2026-11-04：所有dialog高度上限500px——面板与viewport
             （500px减去上下p-4）双层夹紧；内容超出的在面板内滚动。
             内层pr-3给覆盖式thumb留出10px+的右侧间隙，滚动条不再压在
             表单控件上（owner 2026-11-04：滚动条不要重叠表单）。 */
          "fixed top-1/2 left-1/2 z-50 flex max-h-[500px] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-popover p-4 text-xs/relaxed text-popover-foreground ring-1 ring-foreground/10 duration-150 ease-out outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-[180ms] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-[120ms]",
          className
        )}
        {...props}
      >
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="max-h-[calc(500px-2rem)]"
        >
          <div className="flex flex-col gap-4 pr-3">{children}</div>
        </ScrollArea>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-xs/relaxed text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
