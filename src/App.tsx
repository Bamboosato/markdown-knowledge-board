import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useLayoutEffect } from "react";
import { isValidElement } from "react";
import type { DragEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { flushSync } from "react-dom";
import remarkGfm from "remark-gfm";
import {
  Archive,
  Bold,
  Code,
  Download,
  FileDown,
  Italic,
  Link,
  List,
  ListTodo,
  Maximize2,
  Menu,
  Minimize2,
  MoreHorizontal,
  Quote,
  RotateCcw,
  Settings,
  Strikethrough,
  Trash2,
  Upload,
} from "lucide-react";

import "./App.css";
import { MarpSlides } from "./components/MarpSlides";
import { MermaidBlock } from "./components/MermaidBlock";
import {
  DEFAULT_MARP_SETTINGS,
  MARP_HEADING_DIVIDERS,
  MARP_SIZES,
  MARP_THEMES,
  getNoteMarpSettings,
} from "./lib/types";
import type {
  MarpHeadingDivider,
  MarpSize,
  MarpTheme,
  Note,
} from "./lib/types";
import { dbInitError, deleteNote, getAllNotes, saveNote } from "./lib/db";
import {
  parseMarkdownWithFrontmatter,
  toMarkdownWithFrontmatter,
} from "./lib/frontmatter";
import { insertLink, toggleLinePrefix, wrapSelection } from "./lib/markdownEdit";
import { getTaskLineIndexes, toggleTaskAtLine } from "./lib/markdownTasks";

type SaveStatus = "idle" | "draft" | "unsaved" | "saving" | "saved" | "error";
type MobileView = "notes" | "editor";
type ActiveTab = "edit" | "preview" | "slides";
type UnsavedChoice = "save" | "discard" | "cancel";

type UnsavedDialogState = {
  actionLabel: string;
};

type ImportFailure = {
  fileName: string;
  reason: string;
};

type OperationDialogState =
  | {
      kind: "backup";
      status: "complete" | "ready";
      fileName: string;
      noteCount: number;
      resolvedAt: string;
    }
  | {
      kind: "import";
      added: number;
      updated: number;
      skipped: number;
      failed: number;
      failures: ImportFailure[];
    };

type PendingDeleteState = {
  note: Note;
  restoreIndex: number;
  wasSelected: boolean;
  wasDraft: boolean;
};

type DeleteConfirmationState = {
  note: Note;
};

type FilterConditions = {
  query: string;
  tags: string[];
};

type MarkdownCodeElementProps = {
  className?: string;
  children?: unknown;
};

const TAG_SUGGESTION_LIMIT = 8;

type BackupDocument = {
  app: "markdown-knowledge-board";
  version: 1;
  createdAt: string;
  noteCount: number;
  notes: Array<{
    id: string;
    title: string;
    tags: string[];
    updatedAt: number;
    markdown: string;
  }>;
};

type FilePickerWritable = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

type SaveFilePickerHandle = {
  createWritable(): Promise<FilePickerWritable>;
};

type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<SaveFilePickerHandle>;

const UNDO_DELETE_TIMEOUT_MS = 8000;

function extractTitle(content: string, fallback: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const match = /^#\s+(.+)$/.exec(trimmed);
    if (match) {
      return match[1].trim();
    }
  }
  return fallback || "Untitled";
}

function filenameToTitle(name: string): string {
  return name.replace(/\.(?:md|markdown|txt)$/i, "").trim();
}

function getPreviewNoteLinkTitle(href: string): string | null {
  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(href)
  ) {
    return null;
  }

  const pathname = href.split(/[?#]/, 1)[0];
  const encodedFilename = pathname.split("/").pop();
  if (!encodedFilename || !/\.(?:md|markdown)$/i.test(encodedFilename)) {
    return null;
  }

  try {
    return decodeURIComponent(encodedFilename)
      .replace(/\.(?:md|markdown)$/i, "")
      .trim() || null;
  } catch {
    return null;
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${getCurrentTimestamp()}-${Math.random().toString(16).slice(2)}`;
}

function getCurrentTimestamp(): number {
  return Date.now();
}

function formatDate(timestamp: number): string {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toLocaleString();
}

function parseTags(value: string): string[] {
  const tags = new Map<string, string>();
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .forEach((tag) => {
      const normalized = normalizeTag(tag);
      if (normalized && !tags.has(normalized)) {
        tags.set(normalized, tag);
      }
    });
  return Array.from(tags.values());
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function filterNotes(notes: Note[], conditions: FilterConditions): Note[] {
  const query = conditions.query.trim().toLowerCase();
  const tags = conditions.tags.map((tag) => normalizeTag(tag));

  return notes.filter((note) => {
    const matchesQuery =
      query.length === 0 ||
      note.title.toLowerCase().includes(query) ||
      note.body.toLowerCase().includes(query);
    const noteTagKeys = new Set(note.tags.map((value) => normalizeTag(value)));
    const matchesTags =
      tags.length === 0 || tags.every((tag) => noteTagKeys.has(tag));
    return matchesQuery && matchesTags;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeDownloadName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function formatTimestampForFilename(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function saveBackupBlob(
  blob: Blob,
  fileName: string
): Promise<"complete" | "ready" | "canceled"> {
  const picker = (window as Window & { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;

  if (!picker) {
    downloadBlob(blob, fileName);
    return "ready";
  }

  try {
    const handle = await picker.call(window, {
      suggestedName: fileName,
      types: [
        {
          description: "Markdown Knowledge Board backup",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "complete";
  } catch (error) {
    if (isAbortError(error)) {
      return "canceled";
    }
    throw error;
  }
}

function createBackupDocument(notes: Note[], createdAt: string): BackupDocument {
  return {
    app: "markdown-knowledge-board",
    version: 1,
    createdAt,
    noteCount: notes.length,
    notes: notes.map((note) => ({
      id: note.id,
      title: note.title,
      tags: note.tags,
      updatedAt: note.updatedAt,
      markdown: toMarkdownWithFrontmatter(note),
    })),
  };
}

function createNoteFromMarkdown(
  content: string,
  fileName: string,
  overrides?: Partial<Pick<Note, "id" | "title" | "tags" | "updatedAt">>,
  preferFileNameTitle = false
): Note {
  if (content.trim().length === 0) {
    throw new Error("File is empty.");
  }

  const parsed = parseMarkdownWithFrontmatter(content);
  const fallbackTitle = filenameToTitle(fileName);
  const body = parsed.body ?? content;
  const title =
    overrides?.title ??
    parsed.title ??
    (preferFileNameTitle ? fallbackTitle : extractTitle(body, fallbackTitle));

  return {
    id: overrides?.id ?? parsed.id ?? createId(),
    title: title.trim() || "Untitled",
    body,
    tags: overrides?.tags ?? parsed.tags ?? [],
    updatedAt:
      overrides?.updatedAt ?? parsed.updatedAt ?? getCurrentTimestamp(),
    marp: parsed.marp,
  };
}

function parseBackupNotes(content: string, fileName: string): Note[] {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error("Backup file must be a JSON object.");
  }
  if (parsed.app !== "markdown-knowledge-board" || parsed.version !== 1) {
    throw new Error("Unsupported backup format.");
  }
  if (!Array.isArray(parsed.notes)) {
    throw new Error("Backup file does not contain a notes array.");
  }

  return parsed.notes.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Backup note ${index + 1} is invalid.`);
    }
    if (typeof item.markdown !== "string") {
      throw new Error(`Backup note ${index + 1} is missing Markdown content.`);
    }

    const id = typeof item.id === "string" ? item.id : undefined;
    const title = typeof item.title === "string" ? item.title : undefined;
    const tags =
      Array.isArray(item.tags) && item.tags.every((tag) => typeof tag === "string")
        ? item.tags
        : undefined;
    const updatedAt =
      typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)
        ? item.updatedAt
        : undefined;

    return createNoteFromMarkdown(item.markdown, `${fileName}#${index + 1}`, {
      id,
      title,
      tags,
      updatedAt,
    });
  });
}

function parseImportFileContent(
  content: string,
  fileName: string,
  importKind: "markdown" | "backup"
): Note[] {
  if (importKind === "backup") {
    if (!/\.json$/i.test(fileName)) {
      throw new Error("Only .json backup files can be imported here.");
    }
    return parseBackupNotes(content, fileName);
  }
  if (!/\.(?:md|markdown|txt)$/i.test(fileName)) {
    throw new Error("Only .md, .markdown, and .txt files can be imported here.");
  }
  return [createNoteFromMarkdown(content, fileName, undefined, true)];
}

function getTaskLabelText(lineText: string): string {
  const text = lineText.replace(/^\s*[-*]\s*\[[ x]\]\s+/i, "").trim();
  return text || "Task";
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function areMarpSettingsEqual(left: Note, right: Note): boolean {
  const leftMarp = getNoteMarpSettings(left);
  const rightMarp = getNoteMarpSettings(right);
  return (
    leftMarp.enabled === rightMarp.enabled &&
    leftMarp.theme === rightMarp.theme &&
    leftMarp.size === rightMarp.size &&
    leftMarp.paginate === rightMarp.paginate &&
    leftMarp.headingDivider === rightMarp.headingDivider
  );
}

function areNotesEquivalent(left: Note, right: Note): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.body === right.body &&
    left.updatedAt === right.updatedAt &&
    areStringArraysEqual(left.tags, right.tags) &&
    areMarpSettingsEqual(left, right)
  );
}

function getInitialLastBackupAt(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  const stored = localStorage.getItem("lastBackupAt");
  return stored && !Number.isNaN(new Date(stored).getTime()) ? stored : null;
}

function formatBackupTimestamp(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function App() {
  const isMacPlatform = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const saveTooltip = isMacPlatform ? "Save (⌘S)" : "Save (Ctrl+S)";
  const newNoteTooltip = isMacPlatform
    ? "New Note (Option+N)"
    : "New Note (Alt+N)";
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftMarpEnabled, setDraftMarpEnabled] = useState(
    DEFAULT_MARP_SETTINGS.enabled
  );
  const [draftMarpSize, setDraftMarpSize] = useState<MarpSize>(
    DEFAULT_MARP_SETTINGS.size
  );
  const [draftMarpTheme, setDraftMarpTheme] = useState<MarpTheme>(
    DEFAULT_MARP_SETTINGS.theme
  );
  const [draftMarpPaginate, setDraftMarpPaginate] = useState(
    DEFAULT_MARP_SETTINGS.paginate
  );
  const [draftMarpHeadingDivider, setDraftMarpHeadingDivider] = useState<
    MarpHeadingDivider | false
  >(DEFAULT_MARP_SETTINGS.headingDivider);
  const [draftMarpHeadingDividerLevel, setDraftMarpHeadingDividerLevel] =
    useState<MarpHeadingDivider>(1);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<number>(0);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [previewLinkNotice, setPreviewLinkNotice] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("notes");
  const [unsavedDialog, setUnsavedDialog] =
    useState<UnsavedDialogState | null>(null);
  const unsavedChoiceResolverRef = useRef<((choice: UnsavedChoice) => void) | null>(
    null
  );
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const editScrollTopRef = useRef(0);
  const previewScrollTopRef = useRef(0);
  const previewAnchorRef = useRef<{
    element: HTMLElement;
    offsetTop: number;
  } | null>(null);
  const scrollPositionNoteIdRef = useRef<string | null>(null);
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [filterDraftSearchQuery, setFilterDraftSearchQuery] = useState("");
  const [filterDraftTags, setFilterDraftTags] = useState<string[]>([]);
  const [filterTagInput, setFilterTagInput] = useState("");
  const [isTagFilterSuggestOpen, setIsTagFilterSuggestOpen] = useState(false);
  const [activeTagFilterSuggestionIndex, setActiveTagFilterSuggestionIndex] =
    useState(0);
  const filterSearchInputRef = useRef<HTMLInputElement | null>(null);
  const tagFilterInputRef = useRef<HTMLInputElement | null>(null);
  const tagFilterSuggestRef = useRef<HTMLDivElement | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(
    getInitialLastBackupAt
  );
  const [operationDialog, setOperationDialog] =
    useState<OperationDialogState | null>(null);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const appMenuRef = useRef<HTMLDivElement | null>(null);
  const appMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMarpSettingsOpen, setIsMarpSettingsOpen] = useState(false);
  const marpSettingsRef = useRef<HTMLDivElement | null>(null);
  const marpSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const markdownImportInputRef = useRef<HTMLInputElement | null>(null);
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);
  const bodyDragDepthRef = useRef(0);
  const [isBodyDragActive, setIsBodyDragActive] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(
    null
  );
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const pendingDeleteRef = useRef<PendingDeleteState | null>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const [initialDraft, setInitialDraft] = useState<Note | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("edit");
  const [previewMountedForNoteId, setPreviewMountedForNoteId] = useState<
    string | null
  >(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [isTagSuggestOpen, setIsTagSuggestOpen] = useState(false);
  const [activeTagSuggestionIndex, setActiveTagSuggestionIndex] = useState(0);
  const tagTextInputRef = useRef<HTMLInputElement | null>(null);
  const tagSuggestRef = useRef<HTMLDivElement | null>(null);
  const draftLines = useMemo(() => draftBody.split("\n"), [draftBody]);
  const taskLineIndexes = useMemo(
    () => new Set(getTaskLineIndexes(draftBody)),
    [draftBody]
  );

  useEffect(() => {
    if (!previewLinkNotice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setPreviewLinkNotice(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [previewLinkNotice]);

  useLayoutEffect(() => {
    if (scrollPositionNoteIdRef.current !== selectedId) {
      scrollPositionNoteIdRef.current = selectedId;
      editScrollTopRef.current = 0;
      previewScrollTopRef.current = 0;
      previewAnchorRef.current = null;
      setPreviewMountedForNoteId(null);
    }

    if (activeTab === "edit" && bodyRef.current) {
      bodyRef.current.scrollTop = editScrollTopRef.current;
    } else if (activeTab === "preview" && previewRef.current) {
      const preview = previewRef.current;
      const restorePreviewPosition = () => {
        preview.scrollTop = previewScrollTopRef.current;
        const anchor = previewAnchorRef.current;
        if (!anchor || !preview.contains(anchor.element)) {
          return;
        }
        const currentOffset =
          anchor.element.getBoundingClientRect().top -
          preview.getBoundingClientRect().top;
        preview.scrollTop += currentOffset - anchor.offsetTop;
        previewScrollTopRef.current = preview.scrollTop;
      };

      restorePreviewPosition();
      let secondFrame = 0;
      const firstFrame = requestAnimationFrame(() => {
        restorePreviewPosition();
        secondFrame = requestAnimationFrame(restorePreviewPosition);
      });
      return () => {
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      };
    }
  }, [activeTab, selectedId]);

  useEffect(() => {
    if (!isAppMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !appMenuRef.current?.contains(target)) {
        setIsAppMenuOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsAppMenuOpen(false);
        appMenuButtonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAppMenuOpen]);

  useEffect(() => {
    if (!isActionsMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !actionsMenuRef.current?.contains(target)) {
        setIsActionsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsActionsMenuOpen(false);
        actionsMenuButtonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isActionsMenuOpen]);

  useEffect(() => {
    if (!isMarpSettingsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !marpSettingsRef.current?.contains(target)) {
        setIsMarpSettingsOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMarpSettingsOpen(false);
        marpSettingsButtonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMarpSettingsOpen]);

  const updateEditorExpanded = (expanded: boolean) => {
    const applyUpdate = () => {
      flushSync(() => setIsEditorExpanded(expanded));
    };
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (!document.startViewTransition || prefersReducedMotion) {
      applyUpdate();
      return;
    }

    document.startViewTransition(applyUpdate);
  };

  useEffect(() => {
    if (!isEditorExpanded) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      updateEditorExpanded(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEditorExpanded]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const stored = await getAllNotes();
      if (active) {
        setNotes(stored.slice().sort((a, b) => b.updatedAt - a.updatedAt));
        setDbError(dbInitError);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (deleteUndoTimerRef.current !== null) {
        window.clearTimeout(deleteUndoTimerRef.current);
      }
    };
  }, []);

  const selectedNote = selectedId
    ? notes.find((note) => note.id === selectedId)
    : undefined;
  const isDraftNote = selectedId !== null && !selectedNote;

  const closeTagSuggestions = () => {
    setIsTagSuggestOpen(false);
    setActiveTagSuggestionIndex(0);
  };

  const closeTagFilterSuggestions = () => {
    setIsTagFilterSuggestOpen(false);
    setActiveTagFilterSuggestionIndex(0);
  };

  useEffect(() => {
    if (!isTagSuggestOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!tagSuggestRef.current?.contains(target)) {
        setIsTagSuggestOpen(false);
        setActiveTagSuggestionIndex(0);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isTagSuggestOpen]);

  useEffect(() => {
    if (!isTagFilterSuggestOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!tagFilterSuggestRef.current?.contains(target)) {
        setIsTagFilterSuggestOpen(false);
        setActiveTagFilterSuggestionIndex(0);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isTagFilterSuggestOpen]);

  const resetDraft = (note?: Note) => {
    closeTagSuggestions();
    if (!note) {
      setDraftTitle("");
      setDraftTags([]);
      setTagInput("");
      setDraftBody("");
      setDraftMarpEnabled(DEFAULT_MARP_SETTINGS.enabled);
      setDraftMarpSize(DEFAULT_MARP_SETTINGS.size);
      setDraftMarpTheme(DEFAULT_MARP_SETTINGS.theme);
      setDraftMarpPaginate(DEFAULT_MARP_SETTINGS.paginate);
      setDraftMarpHeadingDividerLevel(1);
      setDraftMarpHeadingDivider(DEFAULT_MARP_SETTINGS.headingDivider);
      setDraftUpdatedAt(0);
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveStatus("idle");
      setLastSaveError(null);
      setInitialDraft(null);
      return;
    }
    setDraftTitle(note.title);
    setDraftTags(note.tags);
    setTagInput("");
    setDraftBody(note.body);
    const marp = getNoteMarpSettings(note);
    setDraftMarpEnabled(marp.enabled);
    setDraftMarpSize(marp.size);
    setDraftMarpTheme(marp.theme);
    setDraftMarpPaginate(marp.paginate);
    setDraftMarpHeadingDividerLevel(
      marp.headingDivider === false ? 1 : marp.headingDivider
    );
    setDraftMarpHeadingDivider(marp.headingDivider);
    setDraftUpdatedAt(note.updatedAt);
    setIsDirty(false);
    isDirtyRef.current = false;
    setSaveStatus("saved");
    setLastSaveError(null);
    setInitialDraft(null);
  };

  const markDirty = () => {
    setIsDirty(true);
    setDraftUpdatedAt(getCurrentTimestamp());
    isDirtyRef.current = true;
    setLastSaveError(null);
    setSaveStatus((current) => (current === "draft" ? "draft" : "unsaved"));
  };

  const applyEdit = (
    nextValue: string,
    selectionStart: number,
    selectionEnd: number
  ) => {
    const prevScrollTop = bodyRef.current?.scrollTop ?? 0;
    const prevScrollLeft = bodyRef.current?.scrollLeft ?? 0;
    setDraftBody(nextValue);
    markDirty();
    requestAnimationFrame(() => {
      const textarea = bodyRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      textarea.scrollTop = prevScrollTop;
      textarea.scrollLeft = prevScrollLeft;
    });
  };

  const getDraftMarpSettings = (): Note["marp"] =>
    draftMarpEnabled
      ? {
          enabled: true,
          theme: draftMarpTheme,
          size: draftMarpSize,
          paginate: draftMarpPaginate,
          headingDivider: draftMarpHeadingDivider,
        }
      : undefined;

  const getDraftSnapshot = (): Note => {
    const note: Note = {
      id: selectedId ?? createId(),
      title: draftTitle.trim() || "Untitled",
      body: draftBody,
      tags: getEffectiveTags(),
      updatedAt: draftUpdatedAt || getCurrentTimestamp(),
    };
    const marp = getDraftMarpSettings();
    if (marp) {
      note.marp = marp;
    }
    return note;
  };

  const findImportMatchIndex = (candidate: Note, currentNotes: Note[]) => {
    const idMatch = currentNotes.findIndex((note) => note.id === candidate.id);
    if (idMatch >= 0) {
      return idMatch;
    }

    const normalizedTitle = candidate.title.trim().toLowerCase();
    return currentNotes.findIndex(
      (note) =>
        note.title.trim().toLowerCase() === normalizedTitle &&
        note.updatedAt === candidate.updatedAt
    );
  };

  const clearDeleteUndoTimer = () => {
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }
  };

  const finalizePendingDelete = async () => {
    const pending = pendingDeleteRef.current;
    if (!pending) {
      return;
    }

    clearDeleteUndoTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);

    if (pending.wasDraft) {
      return;
    }

    try {
      await deleteNote(pending.note.id);
      setDbError(dbInitError);
    } catch (error) {
      setDbError(getErrorMessage(error, "Failed to delete the note."));
    }
  };

  const schedulePendingDelete = (pending: PendingDeleteState) => {
    clearDeleteUndoTimer();
    pendingDeleteRef.current = pending;
    setPendingDelete(pending);
    deleteUndoTimerRef.current = window.setTimeout(() => {
      void finalizePendingDelete();
    }, UNDO_DELETE_TIMEOUT_MS);
  };

  const handleUndoDelete = async () => {
    const pending = pendingDeleteRef.current;
    if (!pending) {
      return;
    }

    clearDeleteUndoTimer();
    pendingDeleteRef.current = null;
    setPendingDelete(null);

    if (pending.wasDraft) {
      setSelectedId(pending.note.id);
      setDraftTitle(pending.note.title);
      setDraftTags(pending.note.tags);
      setTagInput("");
      closeTagSuggestions();
      setDraftBody(pending.note.body);
      const marp = getNoteMarpSettings(pending.note);
      setDraftMarpEnabled(marp.enabled);
      setDraftMarpSize(marp.size);
      setDraftMarpTheme(marp.theme);
      setDraftMarpPaginate(marp.paginate);
      setDraftMarpHeadingDividerLevel(
        marp.headingDivider === false ? 1 : marp.headingDivider
      );
      setDraftMarpHeadingDivider(marp.headingDivider);
      setDraftUpdatedAt(pending.note.updatedAt);
      setIsDirty(true);
      isDirtyRef.current = true;
      setSaveStatus("draft");
      setLastSaveError(null);
      setInitialDraft(pending.note);
      setMobileView("editor");
      setActiveTab("edit");
      return;
    }

    try {
      await saveNote(pending.note);
      setDbError(dbInitError);
      setNotes((prev) => {
        const without = prev.filter((note) => note.id !== pending.note.id);
        const next = [...without];
        const index = Math.min(Math.max(pending.restoreIndex, 0), next.length);
        next.splice(index, 0, pending.note);
        return next;
      });
      if (pending.wasSelected) {
        setSelectedId(pending.note.id);
        resetDraft(pending.note);
        setMobileView("editor");
      }
    } catch (error) {
      setDbError(getErrorMessage(error, "Failed to restore the note."));
    }
  };

  const handleWrap = (
    prefix: string,
    suffix: string,
    placeholder: string
  ) => {
    if (!bodyRef.current) {
      return;
    }
    const { selectionStart, selectionEnd } = bodyRef.current;
    if ((selectionStart ?? 0) === (selectionEnd ?? 0)) {
      return;
    }
    const result = wrapSelection(
      draftBody,
      selectionStart ?? 0,
      selectionEnd ?? 0,
      prefix,
      suffix,
      placeholder
    );
    applyEdit(result.value, result.selectionStart, result.selectionEnd);
  };

  const handleToggleLine = (prefix: string) => {
    if (!bodyRef.current) {
      return;
    }
    const { selectionStart } = bodyRef.current;
    const result = toggleLinePrefix(draftBody, selectionStart ?? 0, prefix);
    applyEdit(result.value, result.selectionStart, result.selectionEnd);
  };

  const handleInsertLink = () => {
    if (!bodyRef.current) {
      return;
    }
    const { selectionStart, selectionEnd } = bodyRef.current;
    const result = insertLink(
      draftBody,
      selectionStart ?? 0,
      selectionEnd ?? 0
    );
    applyEdit(result.value, result.selectionStart, result.selectionEnd);
  };

  const importFiles = async (
    files: File[],
    importKind: "markdown" | "backup"
  ) => {
    if (files.length === 0) {
      return;
    }

    const importTarget =
      importKind === "backup"
        ? "import a backup"
        : "import Markdown or text files";
    const canContinue = await confirmUnsavedTransition(importTarget);
    if (!canContinue) {
      return;
    }

    const imported: Note[] = [];
    const failures: ImportFailure[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let workingNotes = notes.slice();

    setIsImporting(true);

    try {
      for (const file of files) {
        try {
          const content = await file.text();
          const candidates = parseImportFileContent(
            content,
            file.name,
            importKind
          );

          for (const candidate of candidates) {
            const matchIndex = findImportMatchIndex(candidate, workingNotes);
            if (matchIndex >= 0) {
              const existing = workingNotes[matchIndex];
              const nextNote = { ...candidate, id: existing.id };
              if (areNotesEquivalent(existing, nextNote)) {
                skipped += 1;
                continue;
              }

              await saveNote(nextNote);
              workingNotes = workingNotes.map((note, index) =>
                index === matchIndex ? nextNote : note
              );
              imported.push(nextNote);
              updated += 1;
              continue;
            }

            await saveNote(candidate);
            workingNotes = [candidate, ...workingNotes];
            imported.push(candidate);
            added += 1;
          }
        } catch (error) {
          failures.push({
            fileName: file.name,
            reason: getErrorMessage(error, "Failed to import this file."),
          });
        }
      }

      if (imported.length > 0 || skipped > 0) {
        setNotes((prev) =>
          [
            ...workingNotes.filter((note) =>
              prev.some((item) => item.id === note.id)
            ),
            ...workingNotes.filter(
              (note) => !prev.some((item) => item.id === note.id)
            ),
          ].sort((a, b) => b.updatedAt - a.updatedAt)
        );
      }

      setOperationDialog({
        kind: "import",
        added,
        updated,
        skipped,
        failed: failures.length,
        failures,
      });

      setDbError(dbInitError);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImport = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    const importKind =
      input.dataset.importKind === "backup" ? "backup" : "markdown";
    try {
      await importFiles(files, importKind);
    } finally {
      input.value = "";
    }
  };

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleBodyDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event) || isImporting) {
      return;
    }
    event.preventDefault();
    bodyDragDepthRef.current += 1;
    setIsBodyDragActive(true);
  };

  const handleBodyDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event) || isImporting) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleBodyDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    bodyDragDepthRef.current = Math.max(0, bodyDragDepthRef.current - 1);
    if (bodyDragDepthRef.current === 0) {
      setIsBodyDragActive(false);
    }
  };

  const handleBodyDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    bodyDragDepthRef.current = 0;
    setIsBodyDragActive(false);
    if (isImporting) {
      return;
    }
    await importFiles(Array.from(event.dataTransfer.files), "markdown");
  };

  const handleNewNote = async () => {
    const canContinue = await confirmUnsavedTransition("create a new note");
    if (!canContinue) {
      return;
    }
    const note: Note = {
      id: createId(),
      title: "",
      body: "",
      tags: [],
      updatedAt: getCurrentTimestamp(),
    };
    setSelectedId(note.id);
    setDraftTitle(note.title);
    setDraftTags([]);
    setTagInput("");
    closeTagSuggestions();
    setDraftBody(note.body);
    setDraftMarpEnabled(DEFAULT_MARP_SETTINGS.enabled);
    setDraftMarpSize(DEFAULT_MARP_SETTINGS.size);
    setDraftMarpTheme(DEFAULT_MARP_SETTINGS.theme);
    setDraftMarpPaginate(DEFAULT_MARP_SETTINGS.paginate);
    setDraftMarpHeadingDividerLevel(1);
    setDraftMarpHeadingDivider(DEFAULT_MARP_SETTINGS.headingDivider);
    setDraftUpdatedAt(note.updatedAt);
    setIsDirty(true);
    isDirtyRef.current = true;
    setSaveStatus("draft");
    setLastSaveError(null);
    setInitialDraft(note);
    setMobileView("editor");
    setActiveTab("edit");
    setSlideIndex(0);
  };

  const candidateTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const note of notes) {
      for (const tag of note.tags) {
        const normalized = normalizeTag(tag);
        if (!normalized) {
          continue;
        }
        if (!seen.has(normalized)) {
          seen.set(normalized, tag);
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [notes]);

  const selectedTagKeys = useMemo(
    () => new Set(draftTags.map((tag) => normalizeTag(tag))),
    [draftTags]
  );
  const tagSuggestionQuery = normalizeTag(tagInput);
  const suggestedTags = useMemo(
    () =>
      candidateTags
        .filter((tag) => {
          const normalized = normalizeTag(tag);
          return (
            !selectedTagKeys.has(normalized) &&
            (tagSuggestionQuery.length === 0 ||
              normalized.includes(tagSuggestionQuery))
          );
        })
        .slice(0, TAG_SUGGESTION_LIMIT),
    [candidateTags, selectedTagKeys, tagSuggestionQuery]
  );

  const hasTagSuggestions = isTagSuggestOpen && suggestedTags.length > 0;
  const activeTagSuggestionSafeIndex =
    suggestedTags.length === 0
      ? 0
      : Math.min(activeTagSuggestionIndex, suggestedTags.length - 1);
  const activeTagFilterValues = useMemo(
    () => parseTags(tagFilter),
    [tagFilter]
  );
  const filterDraftTagKeys = useMemo(
    () => new Set(filterDraftTags.map((tag) => normalizeTag(tag))),
    [filterDraftTags]
  );
  const tagFilterSuggestionQuery = normalizeTag(filterTagInput);
  const suggestedTagFilters = useMemo(
    () =>
      candidateTags
        .filter((tag) => {
          const normalized = normalizeTag(tag);
          return (
            !filterDraftTagKeys.has(normalized) &&
            (tagFilterSuggestionQuery.length === 0 ||
              normalized.includes(tagFilterSuggestionQuery))
          );
        })
        .slice(0, TAG_SUGGESTION_LIMIT),
    [candidateTags, filterDraftTagKeys, tagFilterSuggestionQuery]
  );
  const hasTagFilterSuggestions =
    isTagFilterSuggestOpen && suggestedTagFilters.length > 0;
  const activeTagFilterSuggestionSafeIndex =
    suggestedTagFilters.length === 0
      ? 0
      : Math.min(activeTagFilterSuggestionIndex, suggestedTagFilters.length - 1);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    const normalized = normalizeTag(trimmed);
    if (!normalized) {
      return;
    }
    const hasTag = draftTags.some(
      (existing) => normalizeTag(existing) === normalized
    );
    if (hasTag) {
      return;
    }
    setDraftTags((prev) => [...prev, trimmed]);
    setIsDirty(true);
    setDraftUpdatedAt(getCurrentTimestamp());
    isDirtyRef.current = true;
  };

  const selectSuggestedTag = (tag: string) => {
    addTag(tag);
    setTagInput("");
    setIsTagSuggestOpen(true);
    setActiveTagSuggestionIndex(0);
  };

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestedTags.length > 0) {
      event.preventDefault();
      setIsTagSuggestOpen(true);
      setActiveTagSuggestionIndex(
        (index) => (index + 1) % suggestedTags.length
      );
      return;
    }

    if (event.key === "ArrowUp" && suggestedTags.length > 0) {
      event.preventDefault();
      setIsTagSuggestOpen(true);
      setActiveTagSuggestionIndex(
        (index) => (index - 1 + suggestedTags.length) % suggestedTags.length
      );
      return;
    }

    if (event.key === "Escape" && isTagSuggestOpen) {
      event.preventDefault();
      closeTagSuggestions();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (hasTagSuggestions) {
        const selectedSuggestion =
          suggestedTags[activeTagSuggestionSafeIndex] ?? suggestedTags[0];
        selectSuggestedTag(selectedSuggestion);
        return;
      }
      addTag(tagInput);
      setTagInput("");
      setIsTagSuggestOpen(true);
      setActiveTagSuggestionIndex(0);
    }
  };

  const handleTagSuggestBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget;
    if (!nextFocused || !event.currentTarget.contains(nextFocused)) {
      closeTagSuggestions();
    }
  };

  const addFilterDraftTag = (tag: string) => {
    const uniqueTags = new Map<string, string>();
    for (const value of [...filterDraftTags, tag]) {
      const normalized = normalizeTag(value);
      if (normalized && !uniqueTags.has(normalized)) {
        uniqueTags.set(normalized, value.trim());
      }
    }
    setFilterDraftTags(Array.from(uniqueTags.values()));
  };

  const removeFilterDraftTag = (tag: string) => {
    const normalized = normalizeTag(tag);
    setFilterDraftTags((prev) =>
      prev.filter((item) => normalizeTag(item) !== normalized)
    );
  };

  const selectTagFilterSuggestion = (tag: string) => {
    addFilterDraftTag(tag);
    setFilterTagInput("");
    setIsTagFilterSuggestOpen(true);
    setActiveTagFilterSuggestionIndex(0);
    tagFilterInputRef.current?.focus();
  };

  const handleTagFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && suggestedTagFilters.length > 0) {
      event.preventDefault();
      setIsTagFilterSuggestOpen(true);
      setActiveTagFilterSuggestionIndex(
        (index) => (index + 1) % suggestedTagFilters.length
      );
      return;
    }

    if (event.key === "ArrowUp" && suggestedTagFilters.length > 0) {
      event.preventDefault();
      setIsTagFilterSuggestOpen(true);
      setActiveTagFilterSuggestionIndex(
        (index) =>
          (index - 1 + suggestedTagFilters.length) % suggestedTagFilters.length
      );
      return;
    }

    if (event.key === "Escape" && isTagFilterSuggestOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeTagFilterSuggestions();
      return;
    }

    if (event.key === "Enter" && hasTagFilterSuggestions) {
      event.preventDefault();
      const selectedSuggestion =
        suggestedTagFilters[activeTagFilterSuggestionSafeIndex] ??
        suggestedTagFilters[0];
      selectTagFilterSuggestion(selectedSuggestion);
      return;
    }

    if (
      event.key === "Backspace" &&
      filterTagInput.length === 0 &&
      filterDraftTags.length > 0
    ) {
      event.preventDefault();
      setFilterDraftTags((prev) => prev.slice(0, -1));
    }
  };

  const handleTagFilterSuggestBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget;
    if (!nextFocused || !event.currentTarget.contains(nextFocused)) {
      closeTagFilterSuggestions();
    }
  };

  const getEffectiveTags = (): string[] => {
    const pending = tagInput.trim();
    if (!pending) {
      return draftTags;
    }
    const normalizedPending = normalizeTag(pending);
    const hasTag = draftTags.some(
      (existing) => normalizeTag(existing) === normalizedPending
    );
    if (hasTag) {
      return draftTags;
    }
    return [...draftTags, pending];
  };

  const removeTag = (tag: string) => {
    const normalized = normalizeTag(tag);
    setDraftTags((prev) =>
      prev.filter((item) => normalizeTag(item) !== normalized)
    );
    setIsDirty(true);
    setDraftUpdatedAt(getCurrentTimestamp());
    isDirtyRef.current = true;
  };

  function resolveUnsavedChoice(choice: UnsavedChoice) {
    unsavedChoiceResolverRef.current?.(choice);
    unsavedChoiceResolverRef.current = null;
    setUnsavedDialog(null);
  }

  function requestUnsavedChoice(actionLabel: string): Promise<UnsavedChoice> {
    return new Promise((resolve) => {
      unsavedChoiceResolverRef.current = resolve;
      setUnsavedDialog({ actionLabel });
    });
  }

  async function confirmUnsavedTransition(actionLabel: string): Promise<boolean> {
    if (!isDirtyRef.current && tagInput.trim().length === 0) {
      return true;
    }

    const choice = await requestUnsavedChoice(actionLabel);
    if (choice === "cancel") {
      return false;
    }

    if (choice === "discard") {
      if (selectedNote) {
        resetDraft(selectedNote);
      } else {
        setSelectedId(null);
        resetDraft();
      }
      return true;
    }

    return handleSave();
  }

  async function handleSave(): Promise<boolean> {
    const trimmedTitle = draftTitle.trim();
    const trimmedTags = getEffectiveTags();

    const now = getCurrentTimestamp();
    const note: Note = {
      id: selectedId ?? createId(),
      title: trimmedTitle || "Untitled",
      body: draftBody,
      tags: trimmedTags,
      updatedAt: now,
    };
    const marp = getDraftMarpSettings();
    if (marp) {
      note.marp = marp;
    }

    setSaveStatus("saving");
    setLastSaveError(null);

    try {
      await saveNote(note);
      setDbError(dbInitError);
      setNotes((prev) => {
        const without = prev.filter((item) => item.id !== note.id);
        return [note, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      setSelectedId(note.id);
      setIsDirty(false);
      setDraftUpdatedAt(now);
      setDraftTags(trimmedTags);
      setTagInput("");
      closeTagSuggestions();
      setSaveStatus("saved");
      setLastSaveError(null);
      isDirtyRef.current = false;
      setInitialDraft(null);
      return true;
    } catch (error) {
      const message = getErrorMessage(error, "Failed to save the note.");
      setDbError(message);
      setSaveStatus("error");
      setLastSaveError(message);
      setIsDirty(true);
      isDirtyRef.current = true;
      return false;
    }
  }

  useEffect(() => {
    const handleKeyboardShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.shiftKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const isSaveShortcut =
        key === "s" && (event.ctrlKey || event.metaKey) && !event.altKey;
      const isNewNoteShortcut =
        key === "n" && event.altKey && !event.ctrlKey && !event.metaKey;
      if (!isSaveShortcut && !isNewNoteShortcut) {
        return;
      }

      event.preventDefault();

      const isDialogOpen =
        unsavedDialog !== null ||
        isFilterDialogOpen ||
        operationDialog !== null ||
        deleteConfirmation !== null;
      if (event.repeat || saveStatus === "saving" || isDialogOpen) {
        return;
      }

      if (isSaveShortcut) {
        void handleSave();
        return;
      }

      void handleNewNote();
    };

    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  });

  const handleSelectNote = async (note: Note) => {
    const canContinue = await confirmUnsavedTransition("open another note");
    if (!canContinue) {
      return;
    }
    setSelectedId(note.id);
    resetDraft(note);
    setMobileView("editor");
    setActiveTab("edit");
    setSlideIndex(0);
  };

  const handlePreviewNoteLink = async (targetTitle: string) => {
    const matches = notes.filter((note) => note.title === targetTitle);
    if (matches.length === 0) {
      setPreviewLinkNotice(`Note not found: ${targetTitle}`);
      return;
    }
    if (matches.length > 1) {
      setPreviewLinkNotice(`Multiple notes found: ${targetTitle}`);
      return;
    }

    const canContinue = await confirmUnsavedTransition("open the linked note");
    if (!canContinue) {
      return;
    }

    const targetNote = matches[0];
    previewScrollTopRef.current = 0;
    previewAnchorRef.current = null;
    if (previewRef.current) {
      previewRef.current.scrollTop = 0;
    }
    setPreviewLinkNotice(null);
    setIsEditorExpanded(false);
    setSelectedId(targetNote.id);
    resetDraft(targetNote);
    setMobileView("editor");
    setActiveTab("preview");
    setPreviewMountedForNoteId(targetNote.id);
    setSlideIndex(0);
  };

  const handleChangeTab = (nextTab: ActiveTab) => {
    if (activeTab === "edit" && bodyRef.current) {
      editScrollTopRef.current = bodyRef.current.scrollTop;
    } else if (activeTab === "preview" && previewRef.current) {
      const preview = previewRef.current;
      previewScrollTopRef.current = preview.scrollTop;
      const previewTop = preview.getBoundingClientRect().top;
      const anchor = Array.from(preview.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.getBoundingClientRect().bottom > previewTop
      );
      previewAnchorRef.current = anchor
        ? {
            element: anchor,
            offsetTop: anchor.getBoundingClientRect().top - previewTop,
          }
        : null;
    }

    if (nextTab === "preview") {
      setPreviewMountedForNoteId(selectedId);
    }
    setActiveTab(nextTab);
    if (nextTab !== "slides") {
      setIsMarpSettingsOpen(false);
    }
    if (nextTab === "slides") {
      setSlideIndex(0);
    }
  };

  const handleShowNotes = async () => {
    const canContinue = await confirmUnsavedTransition("return to Notes");
    if (!canContinue) {
      return;
    }
    setIsEditorExpanded(false);
    setMobileView("notes");
  };

  const hasPendingTagInput = tagInput.trim().length > 0;
  const hasDraftChanges = isDirty || hasPendingTagInput;
  const isDraftDifferentFromInitial =
    isDraftNote && initialDraft
      ? draftTitle !== initialDraft.title ||
        draftBody !== initialDraft.body ||
        draftMarpEnabled !== getNoteMarpSettings(initialDraft).enabled ||
        draftMarpSize !== getNoteMarpSettings(initialDraft).size ||
        draftMarpTheme !== getNoteMarpSettings(initialDraft).theme ||
        draftMarpPaginate !== getNoteMarpSettings(initialDraft).paginate ||
        draftMarpHeadingDivider !==
          getNoteMarpSettings(initialDraft).headingDivider ||
        !areStringArraysEqual(draftTags, initialDraft.tags) ||
        hasPendingTagInput
      : false;
  const canRevertDraft =
    selectedId !== null &&
    (selectedNote ? hasDraftChanges : isDraftDifferentFromInitial);

  const handleRevertDraft = () => {
    if (!canRevertDraft) {
      return;
    }

    const confirmed = window.confirm(
      selectedNote
        ? "Revert unsaved changes to the last loaded version?"
        : "Revert this draft to its initial state?"
    );
    if (!confirmed) {
      return;
    }

    if (selectedNote) {
      resetDraft(selectedNote);
      return;
    }

    if (isDraftNote && initialDraft) {
      setSelectedId(initialDraft.id);
      setDraftTitle(initialDraft.title);
      setDraftTags(initialDraft.tags);
      setTagInput("");
      closeTagSuggestions();
      setDraftBody(initialDraft.body);
      const marp = getNoteMarpSettings(initialDraft);
      setDraftMarpEnabled(marp.enabled);
      setDraftMarpSize(marp.size);
      setDraftMarpTheme(marp.theme);
      setDraftMarpPaginate(marp.paginate);
      setDraftMarpHeadingDividerLevel(
        marp.headingDivider === false ? 1 : marp.headingDivider
      );
      setDraftMarpHeadingDivider(marp.headingDivider);
      setDraftUpdatedAt(initialDraft.updatedAt);
      setIsDirty(true);
      isDirtyRef.current = true;
      setSaveStatus("draft");
      setLastSaveError(null);
      return;
    }

    resetDraft();
  };

  const editorStatus =
    saveStatus === "saving"
      ? { label: "Saving", tone: "saving" }
      : saveStatus === "error"
      ? { label: "Save failed", tone: "error" }
      : isDraftNote
      ? { label: "Draft", tone: "draft" }
      : isDirty
      ? { label: "Unsaved", tone: "unsaved" }
      : selectedId
      ? { label: "Saved", tone: "saved" }
      : { label: "No note", tone: "neutral" };

  const activeFilterCount =
    (searchQuery.trim().length > 0 ? 1 : 0) + activeTagFilterValues.length;
  const hasActiveFilters = activeFilterCount > 0;
  const filteredNotes = filterNotes(notes, {
    query: searchQuery,
    tags: activeTagFilterValues,
  });
  const filterDraftPreviewCount = filterNotes(notes, {
    query: filterDraftSearchQuery,
    tags: filterDraftTags,
  }).length;
  const noteCountText = hasActiveFilters
    ? `${filteredNotes.length} of ${notes.length} notes`
    : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;
  const filterDraftCountText =
    filterDraftSearchQuery.trim().length > 0 || filterDraftTags.length > 0
      ? `${filterDraftPreviewCount} of ${notes.length} notes`
      : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;

  const openFilterDialog = () => {
    setFilterDraftSearchQuery(searchQuery);
    setFilterDraftTags(activeTagFilterValues);
    setFilterTagInput("");
    closeTagFilterSuggestions();
    setIsFilterDialogOpen(true);
    requestAnimationFrame(() => {
      filterSearchInputRef.current?.focus();
    });
  };

  const closeFilterDialog = () => {
    setIsFilterDialogOpen(false);
    setFilterTagInput("");
    closeTagFilterSuggestions();
  };

  const applyFilterDialog = () => {
    setSearchQuery(filterDraftSearchQuery);
    setTagFilter(filterDraftTags.join(", "));
    closeFilterDialog();
  };

  const clearFilterDraft = () => {
    setFilterDraftSearchQuery("");
    setFilterDraftTags([]);
    setFilterTagInput("");
    closeTagFilterSuggestions();
  };

  const clearAppliedFilters = () => {
    setSearchQuery("");
    setTagFilter("");
    if (isFilterDialogOpen) {
      clearFilterDraft();
    }
  };

  const handleFilterBackdropMouseDown = (
    event: MouseEvent<HTMLDivElement>
  ) => {
    if (event.target === event.currentTarget) {
      closeFilterDialog();
    }
  };

  const handleFilterDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFilterDialog();
    }
  };

  const handleDelete = () => {
    const targetNote =
      selectedNote && !isDirtyRef.current && tagInput.trim().length === 0
        ? selectedNote
        : selectedId
        ? getDraftSnapshot()
        : null;

    if (!targetNote) {
      return;
    }

    setDeleteConfirmation({ note: targetNote });
  };

  const closeDeleteConfirmation = () => {
    setDeleteConfirmation(null);
    window.requestAnimationFrame(() => actionsMenuButtonRef.current?.focus());
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation) {
      return;
    }

    const targetNote = deleteConfirmation.note;
    setDeleteConfirmation(null);

    await finalizePendingDelete();

    const restoreIndex = Math.max(
      notes.findIndex((note) => note.id === targetNote.id),
      0
    );
    const wasDraft = !selectedNote;
    const wasSelected = selectedId === targetNote.id;

    if (!wasDraft) {
      setNotes((prev) => prev.filter((note) => note.id !== targetNote.id));
    }
    if (wasSelected) {
      setSelectedId(null);
      resetDraft();
      setMobileView("notes");
    }
    setDbError(dbInitError);
    schedulePendingDelete({
      note: targetNote,
      restoreIndex,
      wasSelected,
      wasDraft,
    });
  };

  const downloadMarkdown = (note: Note) => {
    const title = note.title || "Untitled";
    const content = toMarkdownWithFrontmatter(note);
    const blob = new Blob([content], { type: "text/markdown" });
    downloadBlob(blob, `${sanitizeDownloadName(title)}.md`);
  };

  const handleExport = () => {
    if (!selectedNote && !isDraftNote) {
      return;
    }
    downloadMarkdown(getDraftSnapshot());
  };

  const handleDownloadDraft = () => {
    downloadMarkdown(getDraftSnapshot());
  };

  const handleBackupAll = async () => {
    if (isBackupBusy) {
      return;
    }

    setIsBackupBusy(true);
    setOperationDialog(null);

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const backup = createBackupDocument(notes, nowIso);
      const fileName = `markdown-knowledge-board-backup-${formatTimestampForFilename(
        now
      )}.json`;
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });

      const status = await saveBackupBlob(blob, fileName);
      if (status === "canceled") {
        return;
      }
      localStorage.setItem("lastBackupAt", nowIso);
      setLastBackupAt(nowIso);
      setOperationDialog({
        kind: "backup",
        status,
        fileName,
        noteCount: notes.length,
        resolvedAt: now.toLocaleString(),
      });
    } catch (error) {
      setDbError(getErrorMessage(error, "Failed to create a backup."));
    } finally {
      setIsBackupBusy(false);
    }
  };

  return (
    <div
      className={`app mobile-${mobileView}${
        isEditorExpanded ? " editor-expanded" : ""
      }`}
    >
      <header className="editor-header">
        <div className="editor-title-row">
          <div className="app-menu" ref={appMenuRef}>
            <button
              ref={appMenuButtonRef}
              className="app-menu-button tooltip-button"
              type="button"
              aria-label="Open application menu"
              data-tooltip="Open application menu"
              aria-haspopup="menu"
              aria-expanded={isAppMenuOpen}
              aria-controls="application-menu"
              onClick={() => setIsAppMenuOpen((open) => !open)}
            >
              <Menu aria-hidden="true" />
            </button>
            {isAppMenuOpen ? (
              <div
                id="application-menu"
                className="app-menu-popover"
                role="menu"
                aria-label="Application menu"
              >
                <button
                  className="app-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={isBackupBusy}
                  onClick={() => {
                    setIsAppMenuOpen(false);
                    void handleBackupAll();
                  }}
                >
                  <Archive aria-hidden="true" />
                  <span className="app-menu-item-content">
                    <span>{isBackupBusy ? "Creating Backup" : "Backup All Notes"}</span>
                    <span className="backup-last-label">Last backup</span>
                    <span className="backup-last-value">
                      {lastBackupAt
                        ? formatBackupTimestamp(lastBackupAt)
                        : "No backups yet"}
                    </span>
                  </span>
                </button>
                <button
                  className="app-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={isImporting}
                  onClick={() => {
                    setIsAppMenuOpen(false);
                    backupImportInputRef.current?.click();
                  }}
                >
                  <Upload aria-hidden="true" />
                  {isImporting ? "Importing" : "Import Backup"}
                </button>
              </div>
            ) : null}
            <input
              id="import-backup"
              ref={backupImportInputRef}
              className="file-input"
              type="file"
              accept=".json,application/json"
              data-import-kind="backup"
              multiple
              disabled={isImporting}
              onChange={handleImport}
            />
          </div>
          <h1 className="app-title">Markdown Knowledge Board</h1>
          <div className="editor-status" aria-label="Editor status" aria-live="polite">
            <span className={`status-indicator status-${editorStatus.tone}`}>
              <span className="sr-only">Status: </span>
              <span className="status-dot" aria-hidden="true" />
              <span>{editorStatus.label}</span>
            </span>
          </div>
        </div>
        <div className="editor-actions">
          <button
            className="mobile-back-button secondary-button"
            type="button"
            aria-label="Notes"
            onClick={handleShowNotes}
          >
            ＜ NOTES
          </button>
          <button
            className="primary-button tooltip-button"
            type="button"
            aria-label="Save"
            aria-keyshortcuts="Control+S Meta+S"
            data-tooltip={saveTooltip}
            onClick={handleSave}
            disabled={saveStatus === "saving"}
          >
            {saveStatus === "saving" ? "Saving" : "Save"}
          </button>
          <button
            className="secondary-button icon-action-button tooltip-button"
            type="button"
            aria-label="Revert changes"
            data-tooltip="Revert changes"
            onClick={handleRevertDraft}
            disabled={!canRevertDraft}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <div className="actions-menu" ref={actionsMenuRef}>
            <button
              ref={actionsMenuButtonRef}
              className="secondary-button icon-action-button tooltip-button"
              type="button"
              aria-label="More actions"
              data-tooltip="More actions"
              aria-haspopup="menu"
              aria-expanded={isActionsMenuOpen}
              aria-controls="note-actions-menu"
              disabled={!selectedNote && !isDraftNote}
              onClick={() => setIsActionsMenuOpen((open) => !open)}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
            {isActionsMenuOpen ? (
              <div
                id="note-actions-menu"
                className="actions-menu-popover"
                role="menu"
                aria-label="More actions"
              >
                <button
                  className="actions-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsActionsMenuOpen(false);
                    handleExport();
                  }}
                >
                  <Download aria-hidden="true" />
                  Export
                </button>
                <div className="actions-menu-separator" role="separator" />
                <button
                  className="actions-menu-item actions-menu-item-danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsActionsMenuOpen(false);
                    handleDelete();
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div className="app-workspace">
      <aside className="sidebar">
        <div className="sidebar-primary-actions">
          <button
            className="new-note-button tooltip-button"
            type="button"
            aria-label="New Note"
            aria-keyshortcuts="Alt+N"
            data-tooltip={newNoteTooltip}
            onClick={handleNewNote}
          >
            + New Note
          </button>
          <button
            className="markdown-import-button tooltip-button"
            type="button"
            aria-label="Import Markdown"
            data-tooltip="Import Markdown"
            disabled={isImporting}
            onClick={() => markdownImportInputRef.current?.click()}
          >
            <FileDown aria-hidden="true" />
          </button>
          <input
            id="import-markdown"
            ref={markdownImportInputRef}
            className="file-input"
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            data-import-kind="markdown"
            multiple
            disabled={isImporting}
            onChange={handleImport}
          />
        </div>
        <div className="sidebar-section">
          <div className="notes-header">
            <div>
              <div className="section-title">Notes</div>
              <div className="note-count" aria-live="polite">
                {noteCountText}
              </div>
            </div>
            <div className="notes-filter-actions">
              <button
                className={`filter-button${hasActiveFilters ? " active" : ""}`}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isFilterDialogOpen}
                onClick={openFilterDialog}
              >
                {hasActiveFilters ? `Filter (${activeFilterCount})` : "Filter"}
              </button>
              {hasActiveFilters ? (
                <button
                  className="filter-clear-button"
                  type="button"
                  onClick={clearAppliedFilters}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <ul className="note-list">
            {filteredNotes.length === 0 ? (
              <li className="note-item empty">
                <span>
                  {notes.length === 0
                    ? "No notes yet."
                    : "No notes match your filters."}
                </span>
                {notes.length > 0 && hasActiveFilters ? (
                  <button
                    className="inline-action"
                    type="button"
                    onClick={clearAppliedFilters}
                  >
                    Clear Filters
                  </button>
                ) : null}
              </li>
            ) : (
              filteredNotes.map((note) => (
                <li
                  key={note.id}
                  className={`note-item${
                    note.id === selectedId ? " active" : ""
                  }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectNote(note)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      handleSelectNote(note);
                    }
                  }}
                >
                  <div className="note-title" title={note.title || "Untitled"}>
                    {note.title || "Untitled"}
                  </div>
                  {note.tags.length > 0 ? (
                    <div className="note-tags">
                      {note.tags.map((tag) => (
                        <span className="note-tag" key={tag} title={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="note-meta">{formatDate(note.updatedAt)}</div>
                </li>
              ))
            )}
          </ul>
        </div>
      </aside>
      <main className="editor">
        {lastSaveError ? (
          <div className="db-error save-error-panel">
            <div>
              <strong>Save failed.</strong>
              <div>{lastSaveError}</div>
            </div>
            <div className="error-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={handleSave}
                disabled={saveStatus === "saving"}
              >
                Retry
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={handleDownloadDraft}
              >
                Download Markdown
              </button>
            </div>
          </div>
        ) : dbError ? (
          <div className="db-error">{dbError}</div>
        ) : null}
        <div className="editor-tabs">
          <button
            type="button"
            className={`tab-button${activeTab === "edit" ? " active" : ""}`}
            aria-pressed={activeTab === "edit"}
            onClick={() => handleChangeTab("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={`tab-button${activeTab === "preview" ? " active" : ""}`}
            aria-pressed={activeTab === "preview"}
            onClick={() => handleChangeTab("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            className={`tab-button${activeTab === "slides" ? " active" : ""}`}
            aria-pressed={activeTab === "slides"}
            onClick={() => handleChangeTab("slides")}
          >
            Slides
          </button>
          {activeTab === "slides" ? (
            <div
              className="marp-settings tab-marp-settings"
              aria-label="Slides settings"
            >
              <label className="marp-toggle">
                <input
                  type="checkbox"
                  checked={draftMarpEnabled}
                  onChange={(event) => {
                    setDraftMarpEnabled(event.target.checked);
                    if (!event.target.checked) {
                      setIsMarpSettingsOpen(false);
                    }
                    markDirty();
                  }}
                />
                <span>Marp</span>
              </label>
              <div className="marp-settings-menu" ref={marpSettingsRef}>
                <button
                  ref={marpSettingsButtonRef}
                  type="button"
                  className="marp-settings-button tooltip-button"
                  aria-label="Marp settings"
                  data-tooltip="Marp settings"
                  aria-haspopup="dialog"
                  aria-expanded={isMarpSettingsOpen}
                  aria-controls="marp-settings-popover"
                  disabled={!draftMarpEnabled}
                  onClick={() => setIsMarpSettingsOpen((open) => !open)}
                >
                  <Settings aria-hidden="true" />
                </button>
                {isMarpSettingsOpen ? (
                  <div
                    id="marp-settings-popover"
                    className="marp-settings-popover"
                    role="dialog"
                    aria-labelledby="slide-settings-title"
                  >
                    <div
                      id="slide-settings-title"
                      className="marp-settings-header"
                    >
                      Slide Settings
                    </div>
                    <div className="marp-settings-body">
                      <label className="marp-settings-row">
                        <span>Size</span>
                        <select
                          className="select marp-value-select"
                          value={draftMarpSize}
                          onChange={(event) => {
                            setDraftMarpSize(event.target.value as MarpSize);
                            markDirty();
                          }}
                        >
                          {MARP_SIZES.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="marp-settings-row">
                        <span>Theme</span>
                        <select
                          className="select marp-value-select"
                          value={draftMarpTheme}
                          onChange={(event) => {
                            setDraftMarpTheme(event.target.value as MarpTheme);
                            markDirty();
                          }}
                        >
                          {MARP_THEMES.map((theme) => (
                            <option key={theme} value={theme}>
                              {theme}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="marp-settings-row">
                        <span>Page Numbers</span>
                        <span className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={draftMarpPaginate}
                            onChange={(event) => {
                              setDraftMarpPaginate(event.target.checked);
                              markDirty();
                            }}
                          />
                          <span className="toggle-switch-track" aria-hidden="true" />
                        </span>
                      </label>
                      <div className="marp-settings-row">
                        <span>Heading Divider</span>
                        <div className="marp-heading-divider-controls">
                          <input
                            type="checkbox"
                            aria-label="Heading Divider"
                            checked={draftMarpHeadingDivider !== false}
                            onChange={(event) => {
                              setDraftMarpHeadingDivider(
                                event.target.checked
                                  ? draftMarpHeadingDividerLevel
                                  : false
                              );
                              markDirty();
                            }}
                          />
                          <select
                            className="select marp-heading-divider-select"
                            aria-label="Heading Divider level"
                            value={draftMarpHeadingDividerLevel}
                            disabled={draftMarpHeadingDivider === false}
                            onChange={(event) => {
                              const level = Number(
                                event.target.value
                              ) as MarpHeadingDivider;
                              setDraftMarpHeadingDividerLevel(level);
                              setDraftMarpHeadingDivider(level);
                              markDirty();
                            }}
                          >
                            {MARP_HEADING_DIVIDERS.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {activeTab === "edit" ? (
          <>
            <div className="editor-section metadata-field">
              <div className="label" id="title-label">
                Title
              </div>
              <input
                id="title"
                className="input"
                placeholder="Note title"
                type="text"
                aria-labelledby="title-label"
                value={draftTitle}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  markDirty();
                }}
              />
            </div>
            <div className="editor-section metadata-field">
              <div className="label" id="tags-label">
                Tags
              </div>
              <div
                className="tag-suggest"
                ref={tagSuggestRef}
                onBlur={handleTagSuggestBlur}
              >
                <div
                  className="tag-input"
                  onClick={() => tagTextInputRef.current?.focus()}
                >
                  {draftTags.map((tag) => (
                    <span key={tag} className="tag-chip">
                      {tag}
                      <button
                        className="tag-remove tooltip-button"
                        type="button"
                        aria-label={`Remove tag ${tag}`}
                        data-tooltip={`Remove tag ${tag}`}
                        onClick={() => removeTag(tag)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="tags-input"
                    ref={tagTextInputRef}
                    className="tag-text-input"
                    placeholder="Type tag and press Enter"
                    type="text"
                    role="combobox"
                    aria-labelledby="tags-label"
                    aria-autocomplete="list"
                    aria-expanded={hasTagSuggestions}
                    aria-controls={hasTagSuggestions ? "tag-suggestions" : undefined}
                    aria-activedescendant={
                      hasTagSuggestions
                        ? `tag-suggestion-${activeTagSuggestionSafeIndex}`
                        : undefined
                    }
                    value={tagInput}
                    onFocus={() => setIsTagSuggestOpen(true)}
                    onChange={(event) => {
                      setTagInput(event.target.value);
                      setIsTagSuggestOpen(true);
                      setActiveTagSuggestionIndex(0);
                      markDirty();
                    }}
                    onKeyDown={handleTagInputKeyDown}
                  />
                </div>
                {hasTagSuggestions ? (
                  <div
                    id="tag-suggestions"
                    className="tag-suggestion-list"
                    role="listbox"
                    aria-label="Tag suggestions"
                  >
                    {suggestedTags.map((tag, index) => (
                      <button
                        key={tag}
                        id={`tag-suggestion-${index}`}
                        type="button"
                        role="option"
                        aria-selected={index === activeTagSuggestionSafeIndex}
                        className="tag-suggestion"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveTagSuggestionIndex(index)}
                        onClick={() => selectSuggestedTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
        <div
            hidden={activeTab !== "edit"}
            className={`editor-section editor-body${
              isEditorExpanded ? " is-expanded" : ""
            }${isBodyDragActive ? " is-drag-active" : ""}`}
            onDragEnter={handleBodyDragEnter}
            onDragOver={handleBodyDragOver}
            onDragLeave={handleBodyDragLeave}
            onDrop={handleBodyDrop}
          >
            <div className="body-header">
              <div className="label" id="body-label">
                Body
              </div>
              <div className="md-toolbar" role="toolbar" aria-label="Markdown tools">
                <button
                  type="button"
                  className="md-button md-button-bold tooltip-button"
                  aria-label="Bold"
                  data-tooltip="Bold"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleWrap("**", "**", "bold")}
                >
                  <Bold aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button md-button-italic tooltip-button"
                  aria-label="Italic"
                  data-tooltip="Italic"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleWrap("*", "*", "italic")}
                >
                  <Italic aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button md-button-strike tooltip-button"
                  aria-label="Strike"
                  data-tooltip="Strike"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleWrap("~~", "~~", "strike")}
                >
                  <Strikethrough aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button md-button-code tooltip-button"
                  aria-label="Code"
                  data-tooltip="Code"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleWrap("`", "`", "code")}
                >
                  <Code aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button"
                  aria-label="H1"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleToggleLine("# ")}
                >
                  H1
                </button>
                <button
                  type="button"
                  className="md-button"
                  aria-label="H2"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleToggleLine("## ")}
                >
                  H2
                </button>
                <button
                  type="button"
                  className="md-button tooltip-button"
                  aria-label="Bullet"
                  data-tooltip="Bullet"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleToggleLine("- ")}
                >
                  <List aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button md-button-wide tooltip-button"
                  aria-label="Task"
                  data-tooltip="Task"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleToggleLine("- [ ] ")}
                >
                  <ListTodo aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button tooltip-button"
                  aria-label="Quote"
                  data-tooltip="Quote"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleToggleLine("> ")}
                >
                  <Quote aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="md-button tooltip-button"
                  aria-label="Link"
                  data-tooltip="Link"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={handleInsertLink}
                >
                  <Link aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                className="editor-expand-button tooltip-button"
                aria-label={
                  isEditorExpanded ? "Restore editor" : "Expand editor"
                }
                aria-pressed={isEditorExpanded}
                data-tooltip={
                  isEditorExpanded ? "Restore editor" : "Expand editor"
                }
                onClick={() => updateEditorExpanded(!isEditorExpanded)}
              >
                {isEditorExpanded ? (
                  <Minimize2 aria-hidden="true" />
                ) : (
                  <Maximize2 aria-hidden="true" />
                )}
              </button>
            </div>
            <textarea
              id="body"
              className="textarea textarea-fill"
              placeholder="Write markdown here..."
              rows={16}
              ref={bodyRef}
              aria-labelledby="body-label"
              value={draftBody}
              onChange={(event) => {
                setDraftBody(event.target.value);
                markDirty();
              }}
            />
          </div>
        {activeTab === "preview" ||
        (selectedId !== null && previewMountedForNoteId === selectedId) ? (
          <div
            hidden={activeTab !== "preview"}
            className="preview-panel editor-body"
          >
            {draftBody.trim().length === 0 ? (
              <div className="preview-empty">Nothing to preview.</div>
            ) : (
              <div ref={previewRef} className="mdPreview mdPreview-scroll">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, onClick, ...props }) => (
                      <a
                        {...props}
                        href={href}
                        onClick={(event) => {
                          onClick?.(event);
                          if (event.defaultPrevented || !href) {
                            return;
                          }
                          const targetTitle = getPreviewNoteLinkTitle(href);
                          if (!targetTitle) {
                            return;
                          }
                          event.preventDefault();
                          void handlePreviewNoteLink(targetTitle);
                        }}
                      />
                    ),
                    input: () => null,
                    pre: ({ children }) => {
                      const codeElement = Array.isArray(children)
                        ? children[0]
                        : children;
                      if (
                        isValidElement<MarkdownCodeElementProps>(codeElement)
                      ) {
                        const languageMatch = /language-(\S+)/i.exec(
                          codeElement.props.className ?? ""
                        );
                        const language = languageMatch?.[1]?.toLowerCase();
                        if (language === "mermaid") {
                          const code = String(
                            codeElement.props.children ?? ""
                          ).replace(/\n$/, "");
                          return <MermaidBlock code={code} />;
                        }
                      }
                      return <pre>{children}</pre>;
                    },
                    li: ({ node, children, ...props }) => {
                      const className = props.className ?? "";
                      const isTask = className.includes("task-list-item");

                      if (!isTask) {
                        return <li className={className}>{children}</li>;
                      }

                      const startLine = (node as { position?: { start?: { line?: number } } })
                        ?.position?.start?.line;
                      const lineIndex =
                        typeof startLine === "number" ? startLine - 1 : NaN;

                      const isTaskLine =
                        Number.isFinite(lineIndex) &&
                        taskLineIndexes.has(lineIndex);
                      const lineText = isTaskLine
                        ? draftLines[lineIndex] ?? ""
                        : "";
                      const checked = /^\s*[-*]\s*\[x\]\s+/i.test(lineText);

                      return (
                        <li className={className}>
                          <button
                            type="button"
                            className="taskCheckbox"
                            role="checkbox"
                            aria-checked={checked}
                            aria-label={`${
                              checked ? "Mark task incomplete" : "Mark task complete"
                            }: ${getTaskLabelText(lineText)}`}
                            disabled={!Number.isFinite(lineIndex)}
                            onClick={() => {
                              if (!Number.isFinite(lineIndex)) {
                                return;
                              }
                              setDraftBody((prev) =>
                                toggleTaskAtLine(prev, lineIndex)
                              );
                              markDirty();
                            }}
                          >
                            {checked ? "☑" : "☐"}
                          </button>
                          {children}
                        </li>
                      );
                    },
                  }}
                >
                  {draftBody}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ) : null}
        {activeTab === "slides" ? (
          <MarpSlides
            markdown={draftBody}
            enabled={draftMarpEnabled}
            size={draftMarpSize}
            theme={draftMarpTheme}
            paginate={draftMarpPaginate}
            headingDivider={draftMarpHeadingDivider}
            slideIndex={slideIndex}
            onSlideIndexChange={setSlideIndex}
          />
        ) : null}
      </main>
      </div>
      {isFilterDialogOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={handleFilterBackdropMouseDown}
        >
          <div
            className="filter-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="filter-dialog-title"
            onKeyDown={handleFilterDialogKeyDown}
          >
            <h2 id="filter-dialog-title">Filter notes</h2>
            <div className="filter-dialog-body">
              <div className="filter-field">
                <div className="label" id="filter-search-label">
                  Search
                </div>
                <input
                  id="filter-search"
                  ref={filterSearchInputRef}
                  className="input"
                  placeholder="Search title or body"
                  type="search"
                  aria-labelledby="filter-search-label"
                  value={filterDraftSearchQuery}
                  onChange={(event) =>
                    setFilterDraftSearchQuery(event.target.value)
                  }
                />
              </div>
              <div className="filter-field">
                <div className="label" id="filter-tags-label">
                  Tags
                </div>
                <div
                  className="tag-suggest"
                  ref={tagFilterSuggestRef}
                  onBlur={handleTagFilterSuggestBlur}
                >
                  <div
                    className="tag-input filter-tag-input"
                    onClick={() => tagFilterInputRef.current?.focus()}
                  >
                    {filterDraftTags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                        <button
                          className="tag-remove"
                          type="button"
                          aria-label={`Remove ${tag} filter`}
                          onClick={() => removeFilterDraftTag(tag)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      id="filter-tags-input"
                      ref={tagFilterInputRef}
                      className="tag-text-input"
                      placeholder="Type tag"
                      type="text"
                      role="combobox"
                      aria-labelledby="filter-tags-label"
                      aria-autocomplete="list"
                      aria-expanded={hasTagFilterSuggestions}
                      aria-controls={
                        hasTagFilterSuggestions
                          ? "tag-filter-suggestions"
                          : undefined
                      }
                      aria-activedescendant={
                        hasTagFilterSuggestions
                          ? `tag-filter-suggestion-${activeTagFilterSuggestionSafeIndex}`
                          : undefined
                      }
                      value={filterTagInput}
                      onFocus={() => setIsTagFilterSuggestOpen(true)}
                      onChange={(event) => {
                        setFilterTagInput(event.target.value);
                        setIsTagFilterSuggestOpen(true);
                        setActiveTagFilterSuggestionIndex(0);
                      }}
                      onKeyDown={handleTagFilterKeyDown}
                    />
                  </div>
                  {hasTagFilterSuggestions ? (
                    <div
                      id="tag-filter-suggestions"
                      className="tag-suggestion-list"
                      role="listbox"
                      aria-label="Filter tag suggestions"
                    >
                      {suggestedTagFilters.map((tag, index) => (
                        <button
                          key={tag}
                          id={`tag-filter-suggestion-${index}`}
                          type="button"
                          role="option"
                          aria-selected={
                            index === activeTagFilterSuggestionSafeIndex
                          }
                          className="tag-suggestion"
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() =>
                            setActiveTagFilterSuggestionIndex(index)
                          }
                          onClick={() => selectTagFilterSuggestion(tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="filter-result-count" aria-live="polite">
                {filterDraftCountText}
              </div>
            </div>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={clearFilterDraft}
              >
                Clear Filters
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={closeFilterDialog}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={applyFilterDialog}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {unsavedDialog ? (
        <div className="modal-backdrop">
          <div
            className="unsaved-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-dialog-title"
          >
            <h2 id="unsaved-dialog-title">Unsaved Changes</h2>
            <p>
              Save or discard your changes before you{" "}
              {unsavedDialog.actionLabel}.
            </p>
            <div className="dialog-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => resolveUnsavedChoice("save")}
              >
                Save and Continue
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => resolveUnsavedChoice("discard")}
              >
                Discard and Continue
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => resolveUnsavedChoice("cancel")}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        ) : null}
      {operationDialog ? (
        <div className="modal-backdrop">
          <div
            className="result-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operation-result-title"
          >
            {operationDialog.kind === "backup" ? (
              <>
                <h2 id="operation-result-title">
                  {operationDialog.status === "complete"
                    ? "Backup Complete"
                    : "Backup Ready"}
                </h2>
                {operationDialog.status === "ready" ? (
                  <p className="result-message">
                    The backup file was prepared and the browser download was
                    started. Confirm the save in your browser if prompted.
                  </p>
                ) : null}
                <dl className="result-summary">
                  <div>
                    <dt>File</dt>
                    <dd>{operationDialog.fileName}</dd>
                  </div>
                  <div>
                    <dt>Notes</dt>
                    <dd>{operationDialog.noteCount}</dd>
                  </div>
                  <div>
                    <dt>
                      {operationDialog.status === "complete"
                        ? "Completed"
                        : "Prepared"}
                    </dt>
                    <dd>{operationDialog.resolvedAt}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <h2 id="operation-result-title">Import Complete</h2>
                <dl className="result-summary">
                  <div>
                    <dt>Added</dt>
                    <dd>{operationDialog.added}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{operationDialog.updated}</dd>
                  </div>
                  <div>
                    <dt>Skipped</dt>
                    <dd>{operationDialog.skipped}</dd>
                  </div>
                  <div>
                    <dt>Failed</dt>
                    <dd>{operationDialog.failed}</dd>
                  </div>
                </dl>
                {operationDialog.failures.length > 0 ? (
                  <details className="failure-details">
                    <summary>Failed files</summary>
                    <ul>
                      {operationDialog.failures.map((failure) => (
                        <li key={`${failure.fileName}-${failure.reason}`}>
                          <strong>{failure.fileName}</strong>: {failure.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            )}
            <div className="dialog-actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => setOperationDialog(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteConfirmation ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteConfirmation();
            }
          }}
        >
          <div
            className="delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeDeleteConfirmation();
              }
            }}
          >
            <h2 id="delete-dialog-title">Delete note?</h2>
            <p id="delete-dialog-description">
              “{deleteConfirmation.note.title || "Untitled"}” will be deleted.
              You can undo this action for a short time.
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                autoFocus
                onClick={closeDeleteConfirmation}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void confirmDelete()}
              >
                Delete Note
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingDelete ? (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>Note deleted</span>
          <button
            className="undo-button"
            type="button"
            onClick={handleUndoDelete}
          >
            Undo
          </button>
        </div>
      ) : null}
      {previewLinkNotice ? (
        <div className="preview-link-toast" role="status" aria-live="polite">
          {previewLinkNotice}
        </div>
      ) : null}
    </div>
  );
}

export default App;










