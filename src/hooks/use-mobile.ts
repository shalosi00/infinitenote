import * as React from "react"

const MOBILE_BREAKPOINT = 768

const subscribe = (onStoreChange: () => void) => {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

/**
 * useSyncExternalStore (eslint-plugin-react-hooks 7 set-state-in-effect, #235
 * sweep): the matchMedia query IS the external store — no effect-body
 * setState, and the server snapshot (false) matches the old first-render
 * `!!undefined` exactly.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
