"use client";

/**
 * OneNote-style sidebar tree: Notebooks → Sections → Pages.
 * - single tap: select
 * - double tap on the label: inline rename
 * - kebab menu: CRUD + reorder + colors + trash
 */
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/lib/store";
import { NOTEBOOK_COLORS, NOTEBOOK_COLOR_HEX, type Notebook, type PageMeta, type Section } from "@/lib/types";
import type { Selection } from "@/lib/tree-ops";
import { byOrder } from "@/lib/types";

interface SidebarProps {
  onNavigate?: () => void; // close mobile drawer after selection
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const notebooks = useAppStore((s) => s.notebooks);
  const sections = useAppStore((s) => s.sections);
  const pages = useAppStore((s) => s.pages);
  const selection = useAppStore((s) => s.selection);
  const addNotebook = useAppStore((s) => s.addNotebook);
  const setTrashOpen = useAppStore((s) => s.setTrashOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);

  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Notebooks
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Search all pages (Ctrl+K)"
          aria-label="Search all pages"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Add notebook"
          aria-label="Add notebook"
          onClick={() => void addNotebook()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Notebook tree" className="flex flex-col gap-0.5 p-2">
          {notebooks.map((nb) => (
            <NotebookNode
              key={nb.id}
              notebook={nb}
              sections={sections.filter((s) => s.notebookId === nb.id)}
              pages={pages}
              selection={selection}
              renaming={renaming}
              setRenaming={setRenaming}
              onNavigate={onNavigate}
            />
          ))}
          {notebooks.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No notebooks yet.
              <br />
              Tap + to create your first one.
            </p>
          )}
        </nav>
      </ScrollArea>

      <Separator />
      <div className="p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          size="sm"
          onClick={() => setTrashOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Trash
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* notebook node                                                       */
/* ------------------------------------------------------------------ */

function NotebookNode({
  notebook,
  sections,
  pages,
  selection,
  renaming,
  setRenaming,
  onNavigate,
}: {
  notebook: Notebook;
  sections: Section[];
  pages: PageMeta[];
  selection: Selection | null;
  renaming: string | null;
  setRenaming: (v: string | null) => void;
  onNavigate?: () => void;
}) {
  const expanded = useAppStore((s) => s.expanded.has(notebook.id));
  const toggle = useAppStore((s) => s.toggleExpanded);
  const addSection = useAppStore((s) => s.addSection);
  const rename = useAppStore((s) => s.renameNotebook);
  const recolor = useAppStore((s) => s.recolorNotebook);
  const del = useAppStore((s) => s.deleteNotebook);
  const move = useAppStore((s) => s.moveNotebook);

  const isRenaming = renaming === notebook.id;
  const openFirstPage = () => {
    const sec = [...sections].sort(byOrder)[0];
    if (sec) {
      const page = pages
        .filter((p) => p.sectionId === sec.id)
        .sort(byOrder)[0];
      if (page) {
        useAppStore.getState().selectPage({ notebookId: notebook.id, sectionId: sec.id, pageId: page.id });
        onNavigate?.();
      }
    }
  };

  return (
    <div className="select-none">
      <div
        className="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-sidebar-accent"
        data-testid="notebook-row"
      >
        <button
          type="button"
          className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left"
          aria-expanded={expanded}
          onClick={() => toggle(notebook.id)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span
            className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
            style={{ backgroundColor: NOTEBOOK_COLOR_HEX[notebook.color] }}
            aria-hidden
          />
          {isRenaming ? (
            <RenameInput
              initial={notebook.name}
              onCommit={(v) => {
                if (v.trim()) void rename(notebook.id, v.trim());
                setRenaming(null);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium"
              onDoubleClick={() => setRenaming(notebook.id)}
              title={`${notebook.name} (double-click to rename)`}
            >
              {notebook.name}
            </span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Actions for notebook ${notebook.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => void addSection(notebook.id)}>
              <Plus /> New section
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenaming(notebook.id)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette /> Color
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-40">
                <div className="grid grid-cols-4 gap-1.5 p-2">
                  {NOTEBOOK_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Set color ${c}`}
                      className="h-6 w-6 rounded-md border-2 ring-offset-2 transition-transform hover:scale-110 data-[active]:ring-2"
                      data-active={notebook.color === c}
                      style={{
                        backgroundColor: NOTEBOOK_COLOR_HEX[c],
                        borderColor: notebook.color === c ? "var(--foreground)" : "transparent",
                      }}
                      onClick={() => void recolor(notebook.id, c)}
                    />
                  ))}
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void move(notebook.id, -1)}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void move(notebook.id, 1)}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void del(notebook.id)}>
              <Trash2 /> Move to trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <div className="ml-3 flex flex-col gap-0.5 border-l pl-1">
          {[...sections]
            .sort(byOrder)
            .map((sec) => (
              <SectionNode
                key={sec.id}
                section={sec}
                notebook={notebook}
                pages={pages.filter((p) => p.sectionId === sec.id)}
                selection={selection}
                renaming={renaming}
                setRenaming={setRenaming}
                onNavigate={onNavigate}
              />
            ))}
          <button
            type="button"
            className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => void addSection(notebook.id)}
          >
            <Plus className="h-3.5 w-3.5" /> Add section
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* section node                                                        */
/* ------------------------------------------------------------------ */

function SectionNode({
  section,
  notebook,
  pages,
  selection,
  renaming,
  setRenaming,
  onNavigate,
}: {
  section: Section;
  notebook: Notebook;
  pages: PageMeta[];
  selection: Selection | null;
  renaming: string | null;
  setRenaming: (v: string | null) => void;
  onNavigate?: () => void;
}) {
  const expanded = useAppStore((s) => s.expanded.has(section.id));
  const toggle = useAppStore((s) => s.toggleExpanded);
  const addPage = useAppStore((s) => s.addPage);
  const rename = useAppStore((s) => s.renameSection);
  const del = useAppStore((s) => s.deleteSection);
  const move = useAppStore((s) => s.moveSection);

  const isRenaming = renaming === section.id;

  return (
    <div>
      <div className="group flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-sidebar-accent">
        <button
          type="button"
          className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left"
          aria-expanded={expanded}
          onClick={() => toggle(section.id)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FolderClosed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {isRenaming ? (
            <RenameInput
              initial={section.name}
              onCommit={(v) => {
                if (v.trim()) void rename(section.id, v.trim());
                setRenaming(null);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground/90"
              onDoubleClick={() => setRenaming(section.id)}
              title={`${section.name} (double-click to rename)`}
            >
              {section.name}
            </span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Actions for section ${section.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => void addPage(section.id)}>
              <Plus /> New page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenaming(section.id)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void move(section.id, -1)}>
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void move(section.id, 1)}>
              <ArrowDown /> Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void del(section.id)}>
              <Trash2 /> Move to trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <div className="ml-4 flex flex-col gap-0.5 border-l pl-1">
          {[...pages]
            .sort(byOrder)
            .map((page) => (
              <PageNode
                key={page.id}
                page={page}
                notebook={notebook}
                section={section}
                selected={selection?.pageId === page.id}
                renaming={renaming}
                setRenaming={setRenaming}
                onNavigate={onNavigate}
              />
            ))}
          <button
            type="button"
            className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => void addPage(section.id)}
          >
            <Plus className="h-3.5 w-3.5" /> Add page
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page node                                                           */
/* ------------------------------------------------------------------ */

function PageNode({
  page,
  notebook,
  section,
  selected,
  renaming,
  setRenaming,
  onNavigate,
}: {
  page: PageMeta;
  notebook: Notebook;
  section: Section;
  selected: boolean;
  renaming: string | null;
  setRenaming: (v: string | null) => void;
  onNavigate?: () => void;
}) {
  const rename = useAppStore((s) => s.renamePage);
  const del = useAppStore((s) => s.deletePage);
  const move = useAppStore((s) => s.movePage);
  const selectPage = useAppStore((s) => s.selectPage);
  const isRenaming = renaming === page.id;

  if (isRenaming) {
    return (
      <div className="px-1 py-0.5">
        <RenameInput
          initial={page.title}
          onCommit={(v) => {
            if (v.trim()) void rename(page.id, v.trim());
            setRenaming(null);
          }}
          onCancel={() => setRenaming(null)}
        />
      </div>
    );
  }

  return (
    <div
      className="group relative flex items-center rounded-md pr-1 hover:bg-sidebar-accent"
      data-testid="page-row"
      data-selected={selected}
    >
      {selected && (
        <span
          className="absolute inset-y-1 left-0 w-[3px] rounded-full"
          style={{ backgroundColor: NOTEBOOK_COLOR_HEX[notebook.color] }}
          aria-hidden
        />
      )}
      <button
        type="button"
        className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left"
        aria-current={selected ? "page" : undefined}
        onClick={() => {
          selectPage({ notebookId: notebook.id, sectionId: section.id, pageId: page.id });
          onNavigate?.();
        }}
        onDoubleClick={() => setRenaming(page.id)}
        title={`${page.title} (double-click to rename)`}
      >
        <FileText
          className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-foreground" : "text-muted-foreground"}`}
        />
        <span
          className={`min-w-0 flex-1 truncate text-sm ${selected ? "font-medium text-foreground" : "text-muted-foreground"}`}
        >
          {page.title}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`Actions for page ${page.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={() => setRenaming(page.id)}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void move(page.id, -1)}>
            <ArrowUp /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void move(page.id, 1)}>
            <ArrowDown /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void del(page.id)}>
            <Trash2 /> Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* inline rename input                                                 */
/* ------------------------------------------------------------------ */

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <Input
      ref={ref}
      value={value}
      className="h-7 flex-1 bg-background text-sm"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value);
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      aria-label="Rename"
    />
  );
}

export { NotebookNode, SectionNode, PageNode };
