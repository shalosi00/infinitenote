"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { lastOutsideFocus } from "@/lib/focus-return"
import { isStaleDismissal } from "@/lib/dialog-dismiss-guard"

/**
 * Stale-dismissal guard plumbing (issue #223): the wrapper records the
 * performance.now() instant of every closed->open transition and hands it to
 * DialogContent, which swallows pointerdown-outside dismissals whose ORIGINAL
 * pointerdown predates that instant. Radix 1.3.x (dismissable-layer 1.2.1)
 * defers an outside dismissal to the click event while the CLOSING dialog's
 * layer stays armed for the whole exit animation — without the guard, the
 * Escape->immediate-reopen click arms the stale dismissal and radix's
 * deferred onDismiss kills the fresh open before it renders (measured: open
 * false->true, radix onOpenChange(false) 8 ms later, dialog never appears).
 * A pointerdown that predates the open instant can never belong to this
 * open, so swallowing it is exact, not a timing heuristic.
 */
const DialogOpenedAt = React.createContext<React.RefObject<number> | null>(null)

/**
 * Controlled-open note: every dialog in the app passes `open` from state.
 * When it flips false we immediately clear Radix's inline
 * `pointer-events: none` on <body> — Radix otherwise keeps it until the
 * exit-animated layer unmounts, and for that whole window the first click
 * after closing (a canvas interaction, a raw pointer event) dies on a
 * pointer-transparent body. Radix's own unmount cleanup later restores the
 * value it saved at open (usually empty), a no-op after this.
 */
function Dialog({
  open,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const openedAtRef = React.useRef(0)
  const wasOpenRef = React.useRef(false)
  // Layout effect: runs inside React's discrete-event flush, so the stamp is
  // committed before radix's deferred dismiss handler can read it in the
  // same click dispatch.
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
    <DialogOpenedAt.Provider value={openedAtRef}>
      <DialogPrimitive.Root data-slot="dialog" open={open} {...props} />
    </DialogOpenedAt.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
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
  onCloseAutoFocus,
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const openedAtRef = React.useContext(DialogOpenedAt)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
        onPointerDownOutside={(event) => {
          onPointerDownOutside?.(event)
          if (event.defaultPrevented) return
          // Stale-dismissal guard (issue #223): a dismissal whose original
          // pointerdown predates this dialog's current open instant was
          // armed by the CLOSING dialog's still-armed layer and deferred to
          // this click — swallowing it lets the fresh open survive. Real
          // dismissals (scrim/outside clicks on an OPEN dialog) always carry
          // a pointerdown AFTER the open instant and pass through.
          const openedAt = openedAtRef?.current ?? 0
          if (isStaleDismissal(event.detail.originalEvent.timeStamp, openedAt)) {
            event.preventDefault()
          }
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          // Our dialogs open from controlled state (plain buttons / global
          // keyboard shortcuts), never via DialogTrigger — Radix has no
          // trigger to return focus to, so it falls to <body>. Restore the
          // last element focused outside the overlay instead (WCAG 2.4.3).
          const target = lastOutsideFocus()
          if (target && target.isConnected) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
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
