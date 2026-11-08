"use client";

/**
 * Cross-page full-text search (Ctrl+K / Cmd+K).
 * Reads every page's serialized scene, extracts text element bodies,
 * ranks matches and jumps to the chosen page.
 */
import { useEffect, useMemo, useState } from "react";
import { plural } from "@/lib/plural";
import { FileText, Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAppStore } from "@/lib/store";
import { buildSearchIndex, searchIndex } from "@/lib/search";
import { db } from "@/lib/notes-db";

export function SearchDialog() {
  const open = useAppStore((s) => s.searchOpen);
  const setOpen = useAppStore((s) => s.setSearchOpen);
  const notebooks = useAppStore((s) => s.notebooks);
  const sections = useAppStore((s) => s.sections);
  const pages = useAppStore((s) => s.pages);
  const selectPage = useAppStore((s) => s.revealSelection);
  const [query, setQuery] = useState("");
  const [contents, setContents] = useState<Record<string, string | null>>({});

  // reload the content index on EVERY open (issue #79): the first-open-only
  // cache made search blind to pages created and edits made afterwards
  // until a full reload. One toArray() per dialog open is cheap for a
  // personal notes app and keeps results always fresh.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const rows = await db.pages.toArray();
      const map: Record<string, string | null> = {};
      for (const row of rows) map[row.id] = row.content ?? null;
      if (!cancelled) setContents(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // The index (which JSON.parses every page's scene) depends ONLY on the
  // notebook tree and the content snapshot — never on the query. Splitting
  // the memos keeps per-keystroke work at the ranking pass; rebuilding the
  // index per keystroke parsed every page's serialized scene on every key.
  const index = useMemo(() => {
    const pagesWithContent = pages.map((p) => ({ ...p, content: contents[p.id] ?? null }));
    return buildSearchIndex(notebooks, sections, pagesWithContent);
  }, [pages, sections, notebooks, contents]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    return searchIndex(index, query);
  }, [index, query]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
      <CommandInput
        placeholder={"Search all pages…"}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{"No results found."}</CommandEmpty>
        {results.length > 0 && (
          <CommandGroup heading={`${plural(results.length, "1 page", "# pages")}`}>
            {results.map((hit) => (
              <CommandItem
                key={hit.pageId}
                value={`${hit.title} ${hit.pagePath} ${hit.snippet}`}
                onSelect={() => {
                  selectPage({
                    notebookId: hit.notebookId,
                    sectionId: hit.sectionId,
                    pageId: hit.pageId,
                  });
                  setOpen(false);
                }}
              >
                <FileText className="h-4 w-4 shrink-0 opacity-60" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{hit.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{hit.pagePath}</p>
                  {hit.snippet && (
                    <p className="truncate text-xs text-muted-foreground/70">{hit.snippet}</p>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
