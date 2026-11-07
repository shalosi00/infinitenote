"use client";

/**
 * OneNote-style sidebar tree: Notebooks → Sections → Pages.
 * - single tap: select
 * - double tap on the label: inline rename
 * - kebab menu: CRUD + reorder + colors + trash
 * - select mode: checkbox multi-select with bulk move/delete (issue #27)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { plural } from "@/lib/plural";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderClosed,
  FolderInput,
  FolderOpen,
  FolderSync,
  Keyboard,
  ListChecks,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
  Zap,
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
import { pageHasTag } from "@/lib/tags";
import { allSelected, pruneSelected, toggleSelected, visiblePageIds } from "@/lib/multi-select";
import { MovePagesDialog } from "./move-pages-dialog";
import { ThemesDialog } from "./themes-dialog";
import { useSyncDialog } from "./sync-dialog";
import { NOTEBOOK_COLORS, NOTEBOOK_COLOR_HEX, type Notebook, type PageMeta, type Section } from "@/lib/types";
import type { Selection } from "@/lib/tree-ops";
import { byOrder } from "@/lib/types";

/** Prop bundle drilled to every page row (kept in one type so the tree stays readable). */
interface SelectModeProps {
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (pageId: string) => void;
}

const NO_SELECT: SelectModeProps = {
  selectMode: false,
  selectedIds: new Set<string>(),
  onToggleSelect: () => undefined,
};

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
  const tagFilter = useAppStore((s) => s.tagFilter);
  const setTagFilter = useAppStore((s) => s.setTagFilter);
  const createQuickNote = useAppStore((s) => s.createQuickNote);
  const openTodayPage = useAppStore((s) => s.openTodayPage);
  const expanded = useAppStore((s) => s.expanded);
  const bulkMovePages = useAppStore((s) => s.bulkMovePages);
  const bulkDeletePages = useAppStore((s) => s.bulkDeletePages);

  const [renaming, setRenaming] = useState<string | null>(null);

  /* -------- multi-select (issue #27): UI-layer state only -------- */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRaw, setSelectedRaw] = useState<ReadonlySet<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);

  // entering the tag filter view is a navigation event — it cancels select
  // mode. zustand is an external store, so this is a subscription (setState
  // only runs inside the store's change callback, not in the effect body).
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.tagFilter !== prev.tagFilter) {
          setSelectMode(false);
          setSelectedRaw(new Set());
        }
      }),
    []
  );

  // ids whose pages disappeared (trashed elsewhere / backup restored) are
  // pruned derivationally — the stored set may lag, every read uses this value
  const selected = useMemo(() => pruneSelected(selectedRaw, pages), [selectedRaw, pages]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedRaw(new Set());
    setMoveOpen(false);
  };

  const onToggleSelect = (pageId: string) =>
    setSelectedRaw((prev) => toggleSelected(pruneSelected(prev, pages), pageId));

  const visible = selectMode ? visiblePageIds(pages, sections, expanded) : [];
  const allVisibleSelected = allSelected(selected, visible);

  const onSelectAllToggle = () =>
    setSelectedRaw(allVisibleSelected ? new Set<string>() : new Set(visible));

  const onBulkMove = (targetSectionId: string) => {
    setMoveOpen(false);
    void bulkMovePages([...selected], targetSectionId).then(() => exitSelectMode());
  };

  const onBulkDelete = () => {
    void bulkDeletePages([...selected]).then(() => exitSelectMode());
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex items-center gap-1 px-3 pt-3 pb-2">
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {"Notebooks"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${selectMode ? "bg-accent text-accent-foreground" : ""}`}
          data-testid="multiselect-toggle"
          title={"Select pages for bulk move/delete"}
          aria-label={"Select pages"}
          aria-pressed={selectMode}
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        >
          <ListChecks className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={"Search all pages (Ctrl+K)"}
          aria-label={"Search all pages"}
          onClick={() => setSearchOpen(true)}
        >
          <Search className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={"Add notebook"}
          aria-label={"Add notebook"}
          onClick={() => void addNotebook()}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {/* quick capture — always visible, even inside the tag filter view */}
      <div className="flex gap-1.5 p-2" data-testid="quick-actions">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 flex-1 gap-1.5 text-xs font-medium"
          data-testid="today-button"
          title={"Open today's daily page"}
          aria-label={"Open today's daily page"}
          onClick={() => {
            void openTodayPage();
            onNavigate?.();
          }}
        >
          <CalendarDays className="h-3.5 w-3.5" /> {"Today"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 flex-1 gap-1.5 text-xs font-medium"
          data-testid="quick-note-button"
          title={"New quick note (Ctrl+Alt+N)"}
          aria-label={"New quick note"}
          onClick={() => {
            void createQuickNote();
            onNavigate?.();
          }}
        >
          <Zap className="h-3.5 w-3.5" /> {"Quick note"}
        </Button>
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        {tagFilter ? (
          <TagFilterView
            tag={tagFilter}
            pages={pages}
            sections={sections}
            notebooks={notebooks}
            onClear={() => setTagFilter(null)}
            onNavigate={onNavigate}
          />
        ) : (
        <nav aria-label={"Notebook tree"} className="flex flex-col gap-0.5 p-2">
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
              selectProps={
                selectMode
                  ? { selectMode, selectedIds: selected, onToggleSelect }
                  : NO_SELECT
              }
            />
          ))}
          {notebooks.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {"No notebooks yet."}
              <br />
              {"Tap + to create your first one."}
            </p>
          )}
        </nav>
        )}
      </ScrollArea>

      {selectMode && (
        <div data-testid="bulk-bar" className="border-t bg-sidebar-accent/40 p-2">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <span className="flex-1 text-xs font-medium" data-testid="bulk-count">
              {`${plural(selected.size, "1 selected", "# selected")}`}
            </span>
            <button
              type="button"
              data-testid="bulk-select-all"
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onSelectAllToggle}
              disabled={visible.length === 0}
            >
              {allVisibleSelected ? "Clear" : `All (${visible.length})`}
            </button>
          </div>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              className="h-8 flex-1 gap-1.5 text-xs font-medium"
              data-testid="bulk-move"
              disabled={selected.size === 0}
              onClick={() => setMoveOpen(true)}
            >
              <FolderInput className="h-3.5 w-3.5" /> {"Move to…"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 flex-1 gap-1.5 text-xs font-medium"
              data-testid="bulk-delete"
              disabled={selected.size === 0}
              onClick={onBulkDelete}
            >
              <Trash2 className="h-3.5 w-3.5" /> {"Delete"}
            </Button>
          </div>
        </div>
      )}

      <Separator />
      <div className="flex flex-col gap-0.5 p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          size="sm"
          data-testid="sync-button"
          title={"Sync devices (folder or ZIP)"}
          aria-label={"Sync devices (folder or ZIP)"}
          onClick={() => useSyncDialog.getState().setOpen(true)}
        >
          <FolderSync className="h-4 w-4" />
          {"Sync"}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          size="sm"
          data-testid="shortcuts-button"
          title={"Keyboard shortcuts (?)"}
          aria-label={"Keyboard shortcuts (?)"}
          onClick={() => useAppStore.getState().setShortcutsOpen(true)}
        >
          <Keyboard className="h-4 w-4" />
          {"Shortcuts"}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          size="sm"
          onClick={() => setTrashOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          {"Trash"}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          size="sm"
          data-testid="themes-button"
          title={"Choose your theme"}
          aria-label={"Choose your theme"}
          onClick={() => setThemesOpen(true)}
        >
          <Palette className="h-4 w-4" />
          {"Themes"}
        </Button>
      </div>

      <ThemesDialog open={themesOpen} onOpenChange={setThemesOpen} />
      <MovePagesDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        notebooks={notebooks}
        sections={sections}
        pages={pages}
        selectedIds={selected}
        onMove={onBulkMove}
      />
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
  selectProps,
}: {
  notebook: Notebook;
  sections: Section[];
  pages: PageMeta[];
  selection: Selection | null;
  renaming: string | null;
  setRenaming: (v: string | null) => void;
  onNavigate?: () => void;
  selectProps: SelectModeProps;
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
              <Plus /> {"New section"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenaming(notebook.id)}>
              <Pencil /> {"Rename"}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette /> {"Color"}
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
              <ArrowUp /> {"Move up"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void move(notebook.id, 1)}>
              <ArrowDown /> {"Move down"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void del(notebook.id)}>
              <Trash2 /> {"Move to trash"}
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
                selectProps={selectProps}
              />
            ))}
          <button
            type="button"
            className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => void addSection(notebook.id)}
          >
            <Plus className="h-3.5 w-3.5" /> {"Add section"}
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
  selectProps,
}: {
  section: Section;
  notebook: Notebook;
  pages: PageMeta[];
  selection: Selection | null;
  renaming: string | null;
  setRenaming: (v: string | null) => void;
  onNavigate?: () => void;
  selectProps: SelectModeProps;
}) {
  const expanded = useAppStore((s) => s.expanded.has(section.id));
  const toggle = useAppStore((s) => s.toggleExpanded);
  const addPage = useAppStore((s) => s.addPage);
  const rename = useAppStore((s) => s.renameSection);
  const del = useAppStore((s) => s.deleteSection);
  const move = useAppStore((s) => s.moveSection);

  const isRenaming = renaming === section.id;

  return (
    <div data-testid="section-row" data-section-id={section.id}>
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
              <Plus /> {"New page"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRenaming(section.id)}>
              <Pencil /> {"Rename"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void move(section.id, -1)}>
              <ArrowUp /> {"Move up"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void move(section.id, 1)}>
              <ArrowDown /> {"Move down"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void del(section.id)}>
              <Trash2 /> {"Move to trash"}
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
                selectProps={selectProps}
              />
            ))}
          <button
            type="button"
            className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            onClick={() => void addPage(section.id)}
          >
            <Plus className="h-3.5 w-3.5" /> {"Add page"}
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
  selectProps,
}: {
  page: PageMeta;
  notebook: Notebook;
  section: Section;
  selected: boolean;
  renaming: string | null;
  setRenaming: (v: string | null) => void;
  onNavigate?: () => void;
  selectProps: SelectModeProps;
}) {
  const rename = useAppStore((s) => s.renamePage);
  const duplicate = useAppStore((s) => s.duplicatePage);
  const del = useAppStore((s) => s.deletePage);
  const move = useAppStore((s) => s.movePage);
  const selectPage = useAppStore((s) => s.selectPage);
  const isRenaming = renaming === page.id;
  const { selectMode, selectedIds, onToggleSelect } = selectProps;
  const checked = selectedIds.has(page.id);

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
      data-page-id={page.id}
      data-section-id={section.id}
      data-selected={selected}
      data-checked={selectMode && checked}
    >
      {selectMode && (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          data-testid="page-checkbox"
          aria-label={`Select ${page.title}`}
          className="ml-1.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors"
          style={{
            borderColor: checked ? "var(--primary)" : "var(--border)",
            backgroundColor: checked ? "var(--primary)" : "transparent",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(page.id);
          }}
        >
          {checked && <Check className="h-3 w-3 text-primary-foreground" />}
        </button>
      )}
      {selected && !selectMode && (
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
          if (selectMode) {
            onToggleSelect(page.id);
            return;
          }
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
      {(page.tags?.length ?? 0) > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          {page.tags!.slice(0, 3).map((chip) => (
            <button
              key={chip}
              type="button"
              data-testid={`page-tag-${chip}`}
              className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground hover:bg-accent hover:text-foreground"
              title={`Filter by tag \"${chip}\"`}
              onClick={() => useAppStore.getState().setTagFilter(chip)}
            >
              {chip}
            </button>
          ))}
          {page.tags!.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{page.tags!.length - 3}</span>
          )}
        </span>
      )}
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
            <Pencil /> {"Rename"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void duplicate(page.id)}>
            <Copy /> {"Duplicate"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void move(page.id, -1)}>
            <ArrowUp /> {"Move up"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void move(page.id, 1)}>
            <ArrowDown /> {"Move down"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void del(page.id)}>
            <Trash2 /> {"Move to trash"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tag filter view (sidebar)                                            */
/* ------------------------------------------------------------------ */

function TagFilterView({
  tag,
  pages,
  sections,
  notebooks,
  onClear,
  onNavigate,
}: {
  tag: string;
  pages: PageMeta[];
  sections: Section[];
  notebooks: Notebook[];
  onClear: () => void;
  onNavigate?: () => void;
}) {
  const matches = pages.filter((p) => pageHasTag(p.tags, tag)).sort(byOrder);
  const pathOf = (p: PageMeta) => {
    const sec = sections.find((s) => s.id === p.sectionId);
    const nb = sec ? notebooks.find((n) => n.id === sec.notebookId) : undefined;
    return [nb?.name, sec?.name].filter(Boolean).join(" / ") || "…";
  };

  return (
    <div className="p-2" data-testid="tag-filter-view">
      <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5">
        <TagIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs">
          {`Pages tagged \"${tag}\"`} <span className="font-semibold">"{tag}"</span>
          <span className="ml-1 text-muted-foreground">({matches.length})</span>
        </span>
        <button
          type="button"
          data-testid="tag-filter-clear"
          aria-label={"Clear tag filter"}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {matches.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {"No pages carry this tag."}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {matches.map((p) => {
            const sec = sections.find((s) => s.id === p.sectionId);
            const nb = sec ? notebooks.find((n) => n.id === sec.notebookId) : undefined;
            return (
              <button
                key={p.id}
                type="button"
                data-testid="tag-filter-row"
                className="flex min-h-9 flex-col items-start justify-center gap-0.5 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent"
                onClick={() => {
                  if (sec && nb) {
                    // reveal, not just select (issue #82): the target page may
                    // live in a collapsed section — expand its ancestors so
                    // the sidebar shows where the user landed
                    useAppStore.getState().revealSelection({
                      notebookId: nb.id,
                      sectionId: sec.id,
                      pageId: p.id,
                    });
                  }
                  onNavigate?.();
                }}
              >
                <span className="w-full truncate text-sm">{p.title}</span>
                <span className="w-full truncate text-[10px] text-muted-foreground">{pathOf(p)}</span>
              </button>
            );
          })}
        </div>
      )}
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
        // ignore Enter/Escape while an IME composes (issue #99): Enter
        // confirms the composition, Escape cancels it — neither should
        // commit or abort the rename itself
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") onCommit(value);
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      aria-label={"Rename"}
    />
  );
}

export { NotebookNode, SectionNode, PageNode };