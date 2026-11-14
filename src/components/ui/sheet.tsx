"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { lastOutsideFocus } from "@/lib/focus-return"
import { isStaleDismissal } from "@/lib/dialog-dismiss-guard"

/**
 * Controlled-open note: the app drawer passes `open` from state. On close we
 * immediately clear Radix's inline `pointer-events: none` on <body> — see
 * the Dialog wrapper for the full rationale (first click after close must
 * not die on a pointer-transparent body while the layer exits).
 * The Sheet root carries the same stale-dismissal guard as the Dialog root
 * (issue #223): the drawer's 300 ms exit animation keeps its DismissableLayer
 * armed, and the first click in that window must survive radix's deferred
 * pointerdown-outside dismissal.
 */
const SheetOpenedAt = React.createContext<React.RefObject<number> | null>(null)
function Sheet({
  open,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const openedAtRef = React.useRef(0)
  const wasOpenRef = React.useRef(false)
  React.useLayoutEffect(() => {
    if (open && !wasOpenRef.current) openedAtRef.current = performance.now()
    wasOpenRef.current = !!open
  }, [open])
  React.useEffect(() => {
    if (!open && document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = ""
    }
  }, [open])
  return (
    <SheetOpenedAt.Provider value={openedAtRef}>
      <SheetPrimitive.Root data-slot="sheet" open={open} {...props} />
    </SheetOpenedAt.Provider>
  )
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  onCloseAutoFocus,
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  const openedAtRef = React.useContext(SheetOpenedAt)
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
          className
        )}
        {...props}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event)
          if (event.defaultPrevented) return
          // Stale-dismissal guard (issue #223) — see the Dialog wrapper for
          // the full rationale: a dismissal armed by the closing drawer's
          // layer (pointerdown predating the open instant) must not kill a
          // fresh open.
          const openedAt = openedAtRef?.current ?? 0
          if (isStaleDismissal(event.detail.originalEvent.timeStamp, openedAt)) {
            event.preventDefault()
          }
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          // The mobile drawer opens from controlled state (a plain button),
          // never via SheetTrigger — Radix has no trigger to return focus
          // to, so it falls to <body>. Restore the last element focused
          // outside the overlay instead (WCAG 2.4.3).
          const target = lastOutsideFocus()
          if (target && target.isConnected) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
