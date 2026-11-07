"use client";

/**
 * SSR-safe loader for the browser-only Excalidraw canvas.
 * Always rendered on the client with `ssr: false`.
 */
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ExcalidrawCanvasProps } from "./excalidraw-canvas";

/**
 * Localized loading fallback (issue #97): rendered by next/dynamic while the
 * Excalidraw bundle loads. Client-only (the parent is ssr:false), so hooks
 * are safe here.
 */
function CanvasLoadingFallback() {
  const t = useTranslations("app");
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-sm">{t("loadingCanvas")}</span>
      </div>
    </div>
  );
}

const ExcalidrawCanvas = dynamic(() => import("./excalidraw-canvas"), {
  ssr: false,
  loading: () => <CanvasLoadingFallback />,
});

export default function CanvasEditor(props: ExcalidrawCanvasProps) {
  return <ExcalidrawCanvas {...props} />;
}
