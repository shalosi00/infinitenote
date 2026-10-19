"use client";

/**
 * SSR-safe loader for the browser-only Excalidraw canvas.
 * Always rendered on the client with `ssr: false`.
 */
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { ExcalidrawCanvasProps } from "./excalidraw-canvas";

const ExcalidrawCanvas = dynamic(() => import("./excalidraw-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-muted/30">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-sm">Loading canvas…</span>
      </div>
    </div>
  ),
});

export default function CanvasEditor(props: ExcalidrawCanvasProps) {
  return <ExcalidrawCanvas {...props} />;
}
