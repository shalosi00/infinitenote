"use client";

/**
 * PWA wiring: register the service worker for installability + offline shell.
 * The SW itself is network-first for app code (see public/sw.js), so live
 * reload during development is unaffected.
 */
import { useEffect } from "react";

export function usePWA() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("SW registration skipped:", err);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
}
