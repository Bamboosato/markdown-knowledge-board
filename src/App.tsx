import { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";
import { useLayoutEffect } from "react";
import type {
  CSSProperties,
  DragEvent,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Archive,
  Bold,
  Braces,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Code,
  Code2,
  Download,
  FileDown,
  Filter as FilterIcon,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  HardDrive,
  Italic,
  Link,
  List,
  ListTree,
  ListTodo,
  Maximize2,
  Menu,
  Minimize2,
  MoreHorizontal,
  MoreVertical,
  Pin,
  PinOff,
  Quote,
  RotateCcw,
  Settings,
  Smartphone,
  Strikethrough,
  Table2,
  Trash2,
  Upload,
} from "lucide-react";

import "./App.css";
import {
  MarkdownToolbarMenu,
  type MarkdownToolbarMenuItem,
} from "./components/MarkdownToolbarMenu";
import { ImportChoiceDialog } from "./components/ImportChoiceDialog";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { StyledExportView } from "./components/StyledExportView";
import { MarpSlides } from "./components/MarpSlides";
import { MetadataDialog } from "./components/MetadataDialog";
import { PwaInstallHelpDialog } from "./components/PwaInstallHelpDialog";
import { PwaStatusRegion } from "./components/PwaStatusRegion";
import { PwaUpdateDialog } from "./components/PwaUpdateDialog";
import {
  MarkdownBodyEditor,
  type EditorSelectionSnapshot,
  type MarkdownBodyEditorHandle,
} from "./components/MarkdownBodyEditor";
import { CloudActionDialog } from "./components/cloud/CloudActionDialog";
import { CloudBackupDialog } from "./components/cloud/CloudBackupDialog";
import { CloudRestoreDialog } from "./components/cloud/CloudRestoreDialog";
import { GitHubSection } from "./components/cloud/GitHubSection";
import { useCloudBackup } from "./hooks/useCloudBackup";
import {
  CloudRestoreApplyError,
  useCloudRestore,
} from "./hooks/useCloudRestore";
import { useGitHubSession } from "./hooks/useGitHubSession";
import { usePwaLifecycle } from "./hooks/usePwaLifecycle";
import { CloudApiError } from "./lib/cloudApi";
import {
  CONTENT_FONT_SCALE_DEFAULT,
  CONTENT_FONT_SCALE_STORAGE_KEY,
  getNextContentFontScale,
  readContentFontScale,
} from "./lib/contentFontScale";
import {
  DEFAULT_MARP_SETTINGS,
  MARP_HEADING_DIVIDERS,
  MARP_SIZES,
  MARP_THEMES,
  getNoteMarpSettings,
} from "./lib/types";
import type {
  CustomMetadataEntry,
  MarpHeadingDivider,
  MarpSize,
  MarpTheme,
  Note,
} from "./lib/types";
import { dbInitError, deleteNote, getAllNotes, saveNote } from "./lib/db";
import {
  createBackupDocument,
  parseImportFileContent,
  parseMarkdownBodyFileContent,
} from "./lib/backup";
import {
  areCustomMetadataEqual,
  buildFrontmatterEntries,
  cloneCustomMetadata,
  toMarkdownWithFrontmatter,
} from "./lib/frontmatter";
import { createId, getCurrentTimestamp, getPinnedAt } from "./lib/note";
import { findNoteIndexById, replaceNoteBody } from "./lib/noteImport";
import { getTagSuggestions, normalizeTag } from "./lib/tagSuggestions";
import {
  insertCodeBlock,
  insertLink,
  insertTable,
  toggleLinePrefix,
  toggleSelectedLinePrefixes,
  wrapSelection,
} from "./lib/markdownEdit";
import { toggleTaskAtLine } from "./lib/markdownTasks";
import { getCloudCapability } from "./lib/cloudCapability";
import { requestPersistentStorage } from "./lib/storagePersistence";

type SaveStatus = "idle" | "draft" | "unsaved" | "saving" | "saved" | "error";
type MobileView = "notes" | "editor";
type ActiveTab = "edit" | "preview" | "slides";
type UnsavedChoice = "save" | "discard" | "cancel";
type CloudDialogKind = "sign-in" | "backup" | "restore" | "disconnect";
type AppMenuView = "root" | "local" | "github";
type CloudBackupDialogKind =
  | "passphrase"
  | "empty-warning"
  | "selection"
  | "conflict";
type CloudRestoreDialogKind =
  | "downloading"
  | "passphrase"
  | "selection"
  | "none"
  | "preview"
  | "result";
type TocHeadingLevel = 1 | 2 | 3;
type TocVisibilityState = "closed" | "opening" | "open" | "closing";
type MarkdownMenuId = "format" | "paragraph" | "insert";
type MarkdownCommandId =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "highlight"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bulleted-list"
  | "task-list"
  | "blockquote"
  | "link"
  | "table"
  | "code-block";

type TocItem = {
  key: string;
  index: number;
  level: TocHeadingLevel;
  text: string;
};

type UnsavedDialogState = {
  actionLabel: string;
};

type ImportFailure = {
  fileName: string;
  reason: string;
};

type ImportChoiceDialogState = {
  files: File[];
  targetKind: "draft" | "saved";
  targetNoteId: string | null;
  targetNoteTitle: string;
};

type ImportFilesOptions = {
  returnFocusTarget?: HTMLElement | null;
  confirmUnsaved?: boolean;
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
  focusTarget: "editor-actions" | "note-card";
};

type RevertConfirmationState = {
  target: "saved-note" | "initial-draft";
};

type NoteCardMenuPosition = {
  top: number;
  left: number;
};

type FilterConditions = {
  query: string;
  tags: string[];
};

const TAG_SUGGESTION_LIMIT = 8;
const CONTENT_FONT_WHEEL_THRESHOLD_PX = 60;
const CONTENT_FONT_SCALE_NOTICE_MS = 1200;
const CONTENT_FONT_SCALE_PC_QUERY = "(min-width: 901px) and (pointer: fine)";

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

function getInitialContentFontScale(): number {
  if (typeof window === "undefined") {
    return CONTENT_FONT_SCALE_DEFAULT;
  }

  try {
    return readContentFontScale(window.localStorage);
  } catch {
    return CONTENT_FONT_SCALE_DEFAULT;
  }
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

function isNotePinned(note: Pick<Note, "pinnedAt">): boolean {
  return getPinnedAt(note) !== undefined;
}

function compareNotes(left: Note, right: Note): number {
  const leftPinnedAt = getPinnedAt(left);
  const rightPinnedAt = getPinnedAt(right);

  if (leftPinnedAt !== undefined || rightPinnedAt !== undefined) {
    if (leftPinnedAt === undefined) {
      return 1;
    }
    if (rightPinnedAt === undefined) {
      return -1;
    }
    if (leftPinnedAt !== rightPinnedAt) {
      return rightPinnedAt - leftPinnedAt;
    }
  }

  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return left.id.localeCompare(right.id);
}

function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort(compareNotes);
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

const PRINT_READY_TIMEOUT_MS = 10_000;

async function waitForPrintableContent(element: HTMLElement): Promise<boolean> {
  await Promise.race([
    document.fonts?.ready.catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 1_000)),
  ]);

  const startedAt = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const pendingMermaid = element.querySelector(
        '[data-mermaid-status="loading"]'
      );
      const imagesReady = Array.from(element.querySelectorAll("img")).every(
        (image) => image.complete
      );
      const timedOut = performance.now() - startedAt >= PRINT_READY_TIMEOUT_MS;

      if ((!pendingMermaid && imagesReady) || timedOut) {
        resolve(!timedOut);
        return;
      }
      window.requestAnimationFrame(check);
    };

    window.requestAnimationFrame(check);
  });
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
    getPinnedAt(left) === getPinnedAt(right) &&
    areStringArraysEqual(left.tags, right.tags) &&
    areMarpSettingsEqual(left, right) &&
    areCustomMetadataEqual(left.customMetadata, right.customMetadata)
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
  const cloudCapability = useMemo(() => getCloudCapability(), []);
  const githubSession = useGitHubSession(cloudCapability.status);
  const cloudBackup = useCloudBackup({
    enabled: cloudCapability.status === "enabled",
    session: githubSession.session,
    csrfToken: githubSession.csrfToken,
    isOnline: githubSession.isOnline,
    onReauthorizationRequired: githubSession.requireReauthorization,
  });
  const cloudRestore = useCloudRestore({
    enabled: cloudCapability.status === "enabled",
    session: githubSession.session,
    isOnline: githubSession.isOnline,
    onReauthorizationRequired: githubSession.requireReauthorization,
  });
  const pwa = usePwaLifecycle();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [bodyEditorResetKey, setBodyEditorResetKey] = useState(0);
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
  const [draftCustomMetadata, setDraftCustomMetadata] = useState<
    CustomMetadataEntry[]
  >([]);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [isPrintPreparing, setIsPrintPreparing] = useState(false);
  const [styledExportSnapshot, setStyledExportSnapshot] = useState<{
    title: string;
    body: string;
    tags: string[];
  } | null>(null);
  const [previewLinkNotice, setPreviewLinkNotice] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("notes");
  const [unsavedDialog, setUnsavedDialog] =
    useState<UnsavedDialogState | null>(null);
  const [cloudDialog, setCloudDialog] = useState<CloudDialogKind | null>(null);
  const [cloudBackupDialog, setCloudBackupDialog] =
    useState<CloudBackupDialogKind | null>(null);
  const [cloudBackupDialogError, setCloudBackupDialogError] = useState<
    string | null
  >(null);
  const [cloudRestoreDialog, setCloudRestoreDialog] =
    useState<CloudRestoreDialogKind | null>(null);
  const [cloudRestoreDialogError, setCloudRestoreDialogError] = useState<
    string | null
  >(null);
  const unsavedChoiceResolverRef = useRef<((choice: UnsavedChoice) => void) | null>(
    null
  );
  const bodyRef = useRef<MarkdownBodyEditorHandle | null>(null);
  const printSurfaceRef = useRef<HTMLDivElement | null>(null);
  const noteListRef = useRef<HTMLUListElement | null>(null);
  const [pendingNoteListRevealId, setPendingNoteListRevealId] = useState<
    string | null
  >(null);
  const editorSelectionRef = useRef<EditorSelectionSnapshot | null>(null);
  const [editorSelection, setEditorSelection] =
    useState<EditorSelectionSnapshot | null>(null);
  const [openMarkdownMenu, setOpenMarkdownMenu] =
    useState<MarkdownMenuId | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [contentFontScale, setContentFontScale] = useState(
    getInitialContentFontScale,
  );
  const [contentFontScaleNotice, setContentFontScaleNotice] = useState<
    number | null
  >(null);
  const contentFontScaleRef = useRef(contentFontScale);
  const contentFontScaleNoticeTimerRef = useRef<number | null>(null);
  const contentFontWheelAccumulatorRef = useRef(0);
  const contentFontWheelDirectionRef = useRef<-1 | 0 | 1>(0);
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
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterSearchInputRef = useRef<HTMLInputElement | null>(null);
  const tagFilterInputRef = useRef<HTMLInputElement | null>(null);
  const tagFilterSuggestRef = useRef<HTMLDivElement | null>(null);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(
    getInitialLastBackupAt
  );
  const [operationDialog, setOperationDialog] =
    useState<OperationDialogState | null>(null);
  const [importChoiceDialog, setImportChoiceDialog] =
    useState<ImportChoiceDialogState | null>(null);
  const operationDialogRef = useRef<HTMLDivElement | null>(null);
  const operationDialogCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const operationDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const importChoiceReturnFocusRef = useRef<HTMLElement | null>(null);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
  const [appMenuView, setAppMenuView] = useState<AppMenuView>("root");
  const appMenuRef = useRef<HTMLDivElement | null>(null);
  const appMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const appMenuBackButtonRef = useRef<HTMLButtonElement | null>(null);
  const localDataMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const githubMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const pwaInstallMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const pwaInstallHelpMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const [isPwaInstallHelpOpen, setIsPwaInstallHelpOpen] = useState(false);
  const [isPwaUpdateDialogOpen, setIsPwaUpdateDialogOpen] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isMetadataDialogOpen, setIsMetadataDialogOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const actionsMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewTabButtonRef = useRef<HTMLButtonElement | null>(null);
  const revertButtonRef = useRef<HTMLButtonElement | null>(null);
  const [openNoteCardMenuId, setOpenNoteCardMenuId] = useState<string | null>(
    null
  );
  const [noteCardMenuPosition, setNoteCardMenuPosition] =
    useState<NoteCardMenuPosition | null>(null);
  const [noteCardActionBusyId, setNoteCardActionBusyId] = useState<
    string | null
  >(null);
  const noteCardMenuRef = useRef<HTMLDivElement | null>(null);
  const noteCardMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const noteCardMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isMarpSettingsOpen, setIsMarpSettingsOpen] = useState(false);
  const marpSettingsRef = useRef<HTMLDivElement | null>(null);
  const marpSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const markdownImportInputRef = useRef<HTMLInputElement | null>(null);
  const markdownImportButtonRef = useRef<HTMLButtonElement | null>(null);
  const backupImportInputRef = useRef<HTMLInputElement | null>(null);
  const importDragDepthRef = useRef(0);
  const [isImportDragActive, setIsImportDragActive] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(
    null
  );
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const [revertConfirmation, setRevertConfirmation] =
    useState<RevertConfirmationState | null>(null);
  const pendingDeleteRef = useRef<PendingDeleteState | null>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const [initialDraft, setInitialDraft] = useState<Note | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("preview");
  const [previewMountedForNoteId, setPreviewMountedForNoteId] = useState<
    string | null
  >(null);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [tocVisibility, setTocVisibility] =
    useState<TocVisibilityState>("closed");
  const tocRootRef = useRef<HTMLDivElement | null>(null);
  const tocButtonRef = useRef<HTMLButtonElement | null>(null);
  const tocFirstItemRef = useRef<HTMLButtonElement | null>(null);
  const tocCloseTimerRef = useRef<number | null>(null);
  const tocOpenFrameRef = useRef<number | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [isTagSuggestOpen, setIsTagSuggestOpen] = useState(false);
  const [activeTagSuggestionIndex, setActiveTagSuggestionIndex] = useState(0);
  const tagTextInputRef = useRef<HTMLInputElement | null>(null);
  const tagSuggestRef = useRef<HTMLDivElement | null>(null);
  const isTocRendered = tocVisibility !== "closed";
  const isTocOpen = tocVisibility === "opening" || tocVisibility === "open";
  const hasPreviewContent = draftBody.trim().length > 0;

  const showContentFontScaleNotice = useCallback((scale: number) => {
    if (contentFontScaleNoticeTimerRef.current !== null) {
      window.clearTimeout(contentFontScaleNoticeTimerRef.current);
    }

    setContentFontScaleNotice(scale);
    contentFontScaleNoticeTimerRef.current = window.setTimeout(() => {
      contentFontScaleNoticeTimerRef.current = null;
      setContentFontScaleNotice(null);
    }, CONTENT_FONT_SCALE_NOTICE_MS);
  }, []);

  useEffect(() => {
    contentFontScaleRef.current = contentFontScale;

    try {
      window.localStorage.setItem(
        CONTENT_FONT_SCALE_STORAGE_KEY,
        String(contentFontScale),
      );
    } catch {
      // A blocked storage API must not prevent local editing in this session.
    }

    const frame = window.requestAnimationFrame(() => {
      bodyRef.current?.requestMeasure();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [contentFontScale]);

  useEffect(() => {
    const roots = [bodyRef.current?.getRootElement(), previewRef.current].filter(
      (root): root is HTMLDivElement => root !== null && root !== undefined,
    );
    const uniqueRoots = [...new Set(roots)];
    if (uniqueRoots.length === 0) {
      return;
    }

    const pcMedia = window.matchMedia(CONTENT_FONT_SCALE_PC_QUERY);
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.metaKey || !pcMedia.matches) {
        return;
      }

      event.preventDefault();

      const pixelDelta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * window.innerHeight
            : event.deltaY;
      if (!Number.isFinite(pixelDelta) || pixelDelta === 0) {
        return;
      }

      const direction = Math.sign(pixelDelta) as -1 | 1;
      if (contentFontWheelDirectionRef.current !== direction) {
        contentFontWheelAccumulatorRef.current = 0;
        contentFontWheelDirectionRef.current = direction;
      }

      const accumulated =
        contentFontWheelAccumulatorRef.current + Math.abs(pixelDelta);
      if (accumulated < CONTENT_FONT_WHEEL_THRESHOLD_PX) {
        contentFontWheelAccumulatorRef.current = accumulated;
        return;
      }

      contentFontWheelAccumulatorRef.current =
        accumulated % CONTENT_FONT_WHEEL_THRESHOLD_PX;
      const nextScale = getNextContentFontScale(
        contentFontScaleRef.current,
        direction,
      );
      contentFontScaleRef.current = nextScale;
      setContentFontScale(nextScale);
      showContentFontScaleNotice(nextScale);
    };

    uniqueRoots.forEach((root) => {
      root.addEventListener("wheel", handleWheel, { passive: false });
    });

    return () => {
      uniqueRoots.forEach((root) => {
        root.removeEventListener("wheel", handleWheel);
      });
      contentFontWheelAccumulatorRef.current = 0;
      contentFontWheelDirectionRef.current = 0;
    };
  }, [
    activeTab,
    hasPreviewContent,
    previewMountedForNoteId,
    selectedId,
    showContentFontScaleNotice,
  ]);

  useEffect(
    () => () => {
      if (contentFontScaleNoticeTimerRef.current !== null) {
        window.clearTimeout(contentFontScaleNoticeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!operationDialog) {
      return;
    }
    const frame = window.requestAnimationFrame(() =>
      operationDialogCloseButtonRef.current?.focus()
    );
    return () => window.cancelAnimationFrame(frame);
  }, [operationDialog]);

  const closeOperationDialog = useCallback(() => {
    const returnTarget = operationDialogReturnFocusRef.current;
    operationDialogReturnFocusRef.current = null;
    setOperationDialog(null);
    window.requestAnimationFrame(() => returnTarget?.focus());
  }, []);

  const handleOperationDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeOperationDialog();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(
        operationDialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), summary"
        ) ?? []
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }
      if (first === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeOperationDialog]
  );

  const restoreImportFocus = useCallback((target: HTMLElement | null) => {
    window.requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>(".tab-button.active");
      if (target?.isConnected) {
        target.focus();
      } else {
        fallback?.focus();
      }
    });
  }, []);

  useEffect(() => {
    const closeTimer = window.setTimeout(() => {
      setOpenMarkdownMenu(null);
      setEditorSelection(null);
      editorSelectionRef.current = null;
    }, 0);
    return () => window.clearTimeout(closeTimer);
  }, [activeTab, selectedId]);

  const handleMarkdownMenuOpenChange = useCallback(
    (menuId: string, isOpen: boolean) => {
      setOpenMarkdownMenu((current) => {
        if (isOpen) {
          return menuId as MarkdownMenuId;
        }
        return current === menuId ? null : current;
      });
    },
    []
  );

  const clearTocTimers = useCallback(() => {
    if (tocCloseTimerRef.current !== null) {
      window.clearTimeout(tocCloseTimerRef.current);
      tocCloseTimerRef.current = null;
    }
    if (tocOpenFrameRef.current !== null) {
      window.cancelAnimationFrame(tocOpenFrameRef.current);
      tocOpenFrameRef.current = null;
    }
  }, []);

  const closeToc = useCallback(
    (options: { returnFocus?: boolean; immediate?: boolean } = {}) => {
      clearTocTimers();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      const finishClose = () => {
        setTocVisibility("closed");
        tocCloseTimerRef.current = null;
        if (options.returnFocus) {
          window.requestAnimationFrame(() => tocButtonRef.current?.focus());
        }
      };

      if (options.immediate || reducedMotion) {
        finishClose();
        return;
      }

      setTocVisibility("closing");
      tocCloseTimerRef.current = window.setTimeout(finishClose, 160);
    },
    [clearTocTimers]
  );

  const openToc = useCallback(
    (focusFirstItem: boolean) => {
      clearTocTimers();
      setTocVisibility("opening");
      tocOpenFrameRef.current = window.requestAnimationFrame(() => {
        setTocVisibility("open");
        tocOpenFrameRef.current = null;
        if (focusFirstItem) {
          window.requestAnimationFrame(() => tocFirstItemRef.current?.focus());
        }
      });
    },
    [clearTocTimers]
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
      bodyRef.current.setScrollPosition({ top: editScrollTopRef.current });
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

  useLayoutEffect(() => {
    if (activeTab !== "preview" || !previewRef.current || !selectedId) {
      setTocItems([]);
      closeToc({ immediate: true });
      return;
    }

    let tocIndex = 0;
    const items = Array.from(
      previewRef.current.querySelectorAll<HTMLElement>("h1, h2, h3")
    ).flatMap((heading) => {
      const text = heading.textContent?.trim() ?? "";
      if (!text) {
        return [];
      }
      const level = Number(heading.tagName.slice(1)) as TocHeadingLevel;
      const index = tocIndex;
      tocIndex += 1;
      heading.dataset.tocIndex = String(index);
      heading.tabIndex = -1;
      return [
        {
          key: `${selectedId}:${level}:${index}`,
          index,
          level,
          text,
        },
      ];
    });
    setTocItems(items);
    closeToc({ immediate: true });
  }, [activeTab, closeToc, draftBody, previewMountedForNoteId, selectedId]);

  useEffect(() => {
    if (!isTocOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !tocRootRef.current?.contains(target)) {
        closeToc();
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeToc({ returnFocus: true });
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeToc, isTocOpen]);

  useEffect(
    () => () => {
      clearTocTimers();
    },
    [clearTocTimers]
  );

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
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (appMenuView !== "root") {
        const returnFocusRef =
          appMenuView === "local" ? localDataMenuItemRef : githubMenuItemRef;
        setAppMenuView("root");
        window.requestAnimationFrame(() => returnFocusRef.current?.focus());
        return;
      }

      setIsAppMenuOpen(false);
      appMenuButtonRef.current?.focus();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [appMenuView, isAppMenuOpen]);

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

  useLayoutEffect(() => {
    if (!openNoteCardMenuId) {
      return;
    }

    const trigger = noteCardMenuButtonRef.current;
    const menu = noteCardMenuRef.current;
    if (!trigger || !menu) {
      return;
    }

    const viewportPadding = 8;
    const menuGap = 6;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const opensAbove =
      window.innerHeight - triggerRect.bottom < menuRect.height + menuGap &&
      triggerRect.top >= menuRect.height + menuGap + viewportPadding;
    const requestedTop = opensAbove
      ? triggerRect.top - menuRect.height - menuGap
      : triggerRect.bottom + menuGap;
    const maxTop = Math.max(
      viewportPadding,
      window.innerHeight - menuRect.height - viewportPadding
    );
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - menuRect.width - viewportPadding
    );

    setNoteCardMenuPosition({
      top: Math.round(
        Math.min(Math.max(requestedTop, viewportPadding), maxTop)
      ),
      left: Math.round(
        Math.min(
          Math.max(triggerRect.right - menuRect.width, viewportPadding),
          maxLeft
        )
      ),
    });

    const focusFrame = window.requestAnimationFrame(() => {
      noteCardMenuItemRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [openNoteCardMenuId]);

  useEffect(() => {
    if (!openNoteCardMenuId) {
      return;
    }

    const closeMenu = () => {
      setOpenNoteCardMenuId(null);
      setNoteCardMenuPosition(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !noteCardMenuRef.current?.contains(target) &&
        !noteCardMenuButtonRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        noteCardMenuButtonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openNoteCardMenuId]);

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
        setNotes(sortNotes(stored));
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
    setBodyEditorResetKey((current) => current + 1);
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
      setDraftCustomMetadata([]);
      setIsMetadataDialogOpen(false);
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
    setDraftCustomMetadata(cloneCustomMetadata(note.customMetadata));
    setIsMetadataDialogOpen(false);
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

  const captureEditorSelection = (): EditorSelectionSnapshot | null => {
    const snapshot = bodyRef.current?.getSelectionSnapshot() ?? null;
    if (!snapshot) {
      editorSelectionRef.current = null;
      setEditorSelection(null);
      return null;
    }
    editorSelectionRef.current = snapshot;
    setEditorSelection(snapshot);
    return snapshot;
  };

  const applyEdit = (
    nextValue: string,
    selectionStart: number,
    selectionEnd: number,
    scrollPosition?: Pick<EditorSelectionSnapshot, "scrollTop" | "scrollLeft">
  ) => {
    const editor = bodyRef.current;
    if (!editor) {
      setDraftBody(nextValue);
      markDirty();
      return;
    }

    const currentSelection = editor.getSelectionSnapshot();
    editor.applyEdit({
      value: nextValue,
      selectionStart,
      selectionEnd,
      scrollTop:
        scrollPosition?.scrollTop ?? currentSelection?.scrollTop ?? 0,
      scrollLeft:
        scrollPosition?.scrollLeft ?? currentSelection?.scrollLeft ?? 0,
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
      customMetadata: cloneCustomMetadata(draftCustomMetadata),
    };
    const marp = getDraftMarpSettings();
    const pinnedAt = selectedNote ? getPinnedAt(selectedNote) : undefined;
    if (pinnedAt !== undefined) {
      note.pinnedAt = pinnedAt;
    }
    if (marp) {
      note.marp = marp;
    }
    return note;
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
      setBodyEditorResetKey((current) => current + 1);
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
      setDraftCustomMetadata(cloneCustomMetadata(pending.note.customMetadata));
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

  const executeMarkdownCommand = (commandId: string) => {
    const snapshot = editorSelectionRef.current;
    setOpenMarkdownMenu(null);

    if (
      !snapshot ||
      snapshot.noteId !== selectedId ||
      snapshot.bodyValue !== draftBody ||
      snapshot.start < 0 ||
      snapshot.end > draftBody.length
    ) {
      editorSelectionRef.current = null;
      setEditorSelection(null);
      return;
    }

    const start = Math.min(snapshot.start, snapshot.end);
    const end = Math.max(snapshot.start, snapshot.end);
    const selectedText = draftBody.slice(start, end);
    let result: ReturnType<typeof wrapSelection> | null = null;

    switch (commandId as MarkdownCommandId) {
      case "bold":
        if (end > start) {
          result = wrapSelection(draftBody, start, end, "**", "**", "bold");
        }
        break;
      case "italic":
        if (end > start) {
          result = wrapSelection(draftBody, start, end, "*", "*", "italic");
        }
        break;
      case "strikethrough":
        if (end > start) {
          result = wrapSelection(draftBody, start, end, "~~", "~~", "strike");
        }
        break;
      case "inline-code":
        if (end > start) {
          result = wrapSelection(draftBody, start, end, "`", "`", "code");
        }
        break;
      case "highlight":
        if (end > start && !/[\r\n]/.test(selectedText)) {
          result = wrapSelection(draftBody, start, end, "==", "==", "highlight");
        }
        break;
      case "heading-1":
        result = toggleLinePrefix(draftBody, start, "# ");
        break;
      case "heading-2":
        result = toggleLinePrefix(draftBody, start, "## ");
        break;
      case "heading-3":
        result = toggleLinePrefix(draftBody, start, "### ");
        break;
      case "bulleted-list":
        result = toggleSelectedLinePrefixes(draftBody, start, end, "- ");
        break;
      case "task-list":
        result = toggleSelectedLinePrefixes(
          draftBody,
          start,
          end,
          "- [ ] "
        );
        break;
      case "blockquote":
        result = toggleLinePrefix(draftBody, start, "> ");
        break;
      case "link":
        result = insertLink(draftBody, start, end);
        break;
      case "table":
        result = insertTable(draftBody, start, end);
        break;
      case "code-block":
        result = insertCodeBlock(draftBody, start, end);
        break;
    }

    editorSelectionRef.current = null;
    setEditorSelection(null);
    if (!result || result.value === draftBody) {
      requestAnimationFrame(() => bodyRef.current?.focus());
      return;
    }

    applyEdit(
      result.value,
      result.selectionStart,
      result.selectionEnd,
      snapshot
    );
  };

  const currentEditorSelection = editorSelection;
  const isMarkdownMenuContextCurrent =
    activeTab === "edit" &&
    currentEditorSelection?.noteId === selectedId &&
    currentEditorSelection.bodyValue === draftBody;
  const hasCurrentSelection =
    currentEditorSelection !== null &&
    isMarkdownMenuContextCurrent &&
    currentEditorSelection.end > currentEditorSelection.start;
  const selectedEditorText = currentEditorSelection && hasCurrentSelection
    ? draftBody.slice(currentEditorSelection.start, currentEditorSelection.end)
    : "";
  const hasSingleLineSelection =
    hasCurrentSelection && !/[\r\n]/.test(selectedEditorText);
  const formatMenuItems = useMemo<MarkdownToolbarMenuItem[]>(
    () => [
      {
        id: "bold",
        label: "Bold",
        icon: <Bold />,
        disabled: !hasCurrentSelection,
      },
      {
        id: "italic",
        label: "Italic",
        icon: <Italic />,
        disabled: !hasCurrentSelection,
      },
      {
        id: "strikethrough",
        label: "Strikethrough",
        icon: <Strikethrough />,
        disabled: !hasCurrentSelection,
      },
      {
        id: "inline-code",
        label: "Inline code",
        icon: <Code />,
        disabled: !hasCurrentSelection,
      },
      {
        id: "highlight",
        label: "Highlight",
        icon: <Highlighter />,
        disabled: !hasSingleLineSelection,
      },
    ],
    [hasCurrentSelection, hasSingleLineSelection]
  );
  const paragraphMenuItems = useMemo<MarkdownToolbarMenuItem[]>(
    () => [
      { id: "heading-1", label: "Heading 1", icon: <Heading1 /> },
      { id: "heading-2", label: "Heading 2", icon: <Heading2 /> },
      { id: "heading-3", label: "Heading 3", icon: <Heading3 /> },
      { id: "bulleted-list", label: "Bulleted list", icon: <List /> },
      { id: "task-list", label: "Task list", icon: <ListTodo /> },
      { id: "blockquote", label: "Quote", icon: <Quote /> },
    ],
    []
  );
  const insertMenuItems = useMemo<MarkdownToolbarMenuItem[]>(
    () => [
      { id: "link", label: "Link", icon: <Link /> },
      { id: "table", label: "Table", icon: <Table2 /> },
      { id: "code-block", label: "Code block", icon: <Code2 /> },
    ],
    []
  );

  const showImportResult = (
    result: Extract<OperationDialogState, { kind: "import" }>,
    returnFocusTarget: HTMLElement | null
  ) => {
    operationDialogReturnFocusRef.current = returnFocusTarget;
    setOperationDialog(result);
  };

  const importFiles = async (
    files: File[],
    importKind: "markdown" | "backup",
    options: ImportFilesOptions = {}
  ) => {
    if (files.length === 0) {
      return;
    }

    const resolvedReturnFocus =
      options.returnFocusTarget ??
      (importKind === "backup"
        ? appMenuButtonRef.current
        : markdownImportButtonRef.current);

    if (options.confirmUnsaved !== false) {
      const importTarget =
        importKind === "backup"
          ? "import a backup"
          : "import Markdown or text files";
      const canContinue = await confirmUnsavedTransition(importTarget);
      if (!canContinue) {
        restoreImportFocus(resolvedReturnFocus);
        return;
      }
    }

    const failures: ImportFailure[] = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    setIsImporting(true);

    try {
      let workingNotes: Note[];
      try {
        workingNotes = sortNotes(await getAllNotes());
      } catch (error) {
        const message = getErrorMessage(error, "Failed to read saved notes.");
        setDbError(message);
        showImportResult(
          {
            kind: "import",
            added: 0,
            updated: 0,
            skipped: 0,
            failed: files.length,
            failures: files.map((file) => ({ fileName: file.name, reason: message })),
          },
          resolvedReturnFocus
        );
        return;
      }

      for (const file of files) {
        try {
          const content = await file.text();
          const candidates = parseImportFileContent(
            content,
            file.name,
            importKind
          );

          for (const candidate of candidates) {
            const matchIndex =
              importKind === "backup"
                ? findNoteIndexById(workingNotes, candidate.id)
                : -1;
            if (importKind === "backup" && matchIndex >= 0) {
              const existing = workingNotes[matchIndex];
              if (areNotesEquivalent(existing, candidate)) {
                skipped += 1;
                continue;
              }

              await saveNote(candidate);
              workingNotes = workingNotes.map((note, index) =>
                index === matchIndex ? candidate : note
              );
              updated += 1;
              continue;
            }

            await saveNote(candidate);
            workingNotes = [candidate, ...workingNotes];
            added += 1;
          }
        } catch (error) {
          failures.push({
            fileName: file.name,
            reason: getErrorMessage(error, "Failed to import this file."),
          });
        }
      }

      if (added > 0 || updated > 0) {
        setNotes(sortNotes(workingNotes));
      }

      showImportResult(
        {
          kind: "import",
          added,
          updated,
          skipped,
          failed: failures.length,
          failures,
        },
        resolvedReturnFocus
      );

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

  const getImportChoiceReturnFocus = (): HTMLElement | null => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      return activeElement;
    }
    return document.querySelector<HTMLElement>(".tab-button.active");
  };

  const closeImportChoiceDialog = () => {
    const returnFocusTarget = importChoiceReturnFocusRef.current;
    importChoiceReturnFocusRef.current = null;
    setImportChoiceDialog(null);
    restoreImportFocus(returnFocusTarget);
  };

  const handleAddDroppedFiles = async () => {
    if (!importChoiceDialog) {
      return;
    }
    const { files, targetKind } = importChoiceDialog;
    const returnFocusTarget = importChoiceReturnFocusRef.current;
    importChoiceReturnFocusRef.current = null;
    setImportChoiceDialog(null);
    await importFiles(files, "markdown", {
      returnFocusTarget,
      confirmUnsaved: targetKind === "saved",
    });
  };

  const handleReplaceCurrentNoteBody = async () => {
    if (!importChoiceDialog || importChoiceDialog.files.length !== 1) {
      return;
    }

    const { files, targetKind, targetNoteId } = importChoiceDialog;
    const [file] = files;
    const returnFocusTarget = importChoiceReturnFocusRef.current;
    importChoiceReturnFocusRef.current = null;
    setImportChoiceDialog(null);
    setIsImporting(true);

    try {
      let replacementBase: Note | null = null;
      if (targetKind === "saved") {
        const persistedTarget = notes.find((note) => note.id === targetNoteId);
        if (!persistedTarget || selectedId !== targetNoteId) {
          showImportResult(
            {
              kind: "import",
              added: 0,
              updated: 0,
              skipped: 0,
              failed: 1,
              failures: [
                {
                  fileName: file.name,
                  reason: "The current note is no longer available.",
                },
              ],
            },
            returnFocusTarget
          );
          return;
        }

        replacementBase = persistedTarget;
        if (isDirtyRef.current || tagInput.trim().length > 0) {
          const choice = await requestUnsavedChoice(
            "replace the current note body"
          );
          if (choice === "cancel") {
            restoreImportFocus(returnFocusTarget);
            return;
          }
          if (choice === "discard") {
            resetDraft(persistedTarget);
          } else {
            const draftSnapshot = getDraftSnapshot();
            if (draftSnapshot.id !== targetNoteId || !(await handleSave())) {
              restoreImportFocus(returnFocusTarget);
              return;
            }
            replacementBase = draftSnapshot;
          }
        }
      } else if (selectedNote || selectedId !== targetNoteId) {
        showImportResult(
          {
            kind: "import",
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 1,
            failures: [
              {
                fileName: file.name,
                reason: "The current note is no longer available.",
              },
            ],
          },
          returnFocusTarget
        );
        return;
      }

      let replacementBody: string;
      try {
        replacementBody = parseMarkdownBodyFileContent(
          await file.text(),
          file.name
        );
      } catch (error) {
        showImportResult(
          {
            kind: "import",
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 1,
            failures: [
              {
                fileName: file.name,
                reason: getErrorMessage(error, "Failed to read this file."),
              },
            ],
          },
          returnFocusTarget
        );
        return;
      }

      if (targetKind === "draft") {
        if (draftBody === replacementBody) {
          showImportResult(
            {
              kind: "import",
              added: 0,
              updated: 0,
              skipped: 1,
              failed: 0,
              failures: [],
            },
            returnFocusTarget
          );
          return;
        }

        // Keep React's Draft state authoritative. Import replacement must not
        // depend on CodeMirror emitting an onChange notification after an
        // imperative edit (for example while focus/composition is changing).
        setDraftBody(replacementBody);
        markDirty();
        showImportResult(
          {
            kind: "import",
            added: 0,
            updated: 1,
            skipped: 0,
            failed: 0,
            failures: [],
          },
          returnFocusTarget
        );
        return;
      }

      if (!replacementBase) {
        return;
      }

      const nextNote = replaceNoteBody(
        replacementBase,
        replacementBody,
        getCurrentTimestamp()
      );
      if (!nextNote) {
        showImportResult(
          {
            kind: "import",
            added: 0,
            updated: 0,
            skipped: 1,
            failed: 0,
            failures: [],
          },
          returnFocusTarget
        );
        setDbError(dbInitError);
        return;
      }

      try {
        await saveNote(nextNote);
      } catch (error) {
        const message = getErrorMessage(error, "Failed to save the note.");
        setDbError(message);
        showImportResult(
          {
            kind: "import",
            added: 0,
            updated: 0,
            skipped: 0,
            failed: 1,
            failures: [{ fileName: file.name, reason: message }],
          },
          returnFocusTarget
        );
        return;
      }

      setNotes((currentNotes) =>
        sortNotes([
          nextNote,
          ...currentNotes.filter((note) => note.id !== nextNote.id),
        ])
      );
      setSelectedId(nextNote.id);
      resetDraft(nextNote);
      setDbError(dbInitError);
      void requestPersistentStorage();
      showImportResult(
        {
          kind: "import",
          added: 0,
          updated: 1,
          skipped: 0,
          failed: 0,
          failures: [],
        },
        returnFocusTarget
      );
    } finally {
      setIsImporting(false);
    }
  };

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");

  const handleImportDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event) || isImporting) {
      return;
    }
    event.preventDefault();
    importDragDepthRef.current += 1;
    setIsImportDragActive(true);
  };

  const handleImportDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event) || isImporting) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleImportDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    importDragDepthRef.current = Math.max(0, importDragDepthRef.current - 1);
    if (importDragDepthRef.current === 0) {
      setIsImportDragActive(false);
    }
  };

  const handleImportDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    importDragDepthRef.current = 0;
    setIsImportDragActive(false);
    if (isImporting) {
      return;
    }
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) {
      return;
    }
    importChoiceReturnFocusRef.current = getImportChoiceReturnFocus();
    setImportChoiceDialog({
      files,
      targetKind: selectedNote ? "saved" : "draft",
      targetNoteId: selectedId,
      targetNoteTitle:
        (selectedNote?.title ?? draftTitle.trim()) || "Untitled",
    });
  };

  const handleNewNote = async () => {
    const canContinue = await confirmUnsavedTransition("create a new note");
    if (!canContinue) {
      return;
    }
    setPendingNoteListRevealId(null);
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
    setBodyEditorResetKey((current) => current + 1);
    setDraftMarpEnabled(DEFAULT_MARP_SETTINGS.enabled);
    setDraftMarpSize(DEFAULT_MARP_SETTINGS.size);
    setDraftMarpTheme(DEFAULT_MARP_SETTINGS.theme);
    setDraftMarpPaginate(DEFAULT_MARP_SETTINGS.paginate);
    setDraftMarpHeadingDividerLevel(1);
    setDraftMarpHeadingDivider(DEFAULT_MARP_SETTINGS.headingDivider);
    setDraftUpdatedAt(note.updatedAt);
    setDraftCustomMetadata([]);
    setIsDirty(true);
    isDirtyRef.current = true;
    setSaveStatus("draft");
    setLastSaveError(null);
    setInitialDraft(note);
    setMobileView("editor");
    setActiveTab("edit");
    setSlideIndex(0);
  };

  const suggestedTags = useMemo(
    () => getTagSuggestions(notes, draftTags, tagInput, TAG_SUGGESTION_LIMIT),
    [notes, draftTags, tagInput]
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
  const suggestedTagFilters = useMemo(
    () =>
      getTagSuggestions(
        notes,
        filterDraftTags,
        filterTagInput,
        TAG_SUGGESTION_LIMIT,
      ),
    [notes, filterDraftTags, filterTagInput]
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
      customMetadata: cloneCustomMetadata(draftCustomMetadata),
    };
    const pinnedAt = selectedNote ? getPinnedAt(selectedNote) : undefined;
    if (pinnedAt !== undefined) {
      note.pinnedAt = pinnedAt;
    }
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
        return sortNotes([note, ...without]);
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
      void requestPersistentStorage();
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

  function navigateToGitHubSignIn() {
    window.location.assign("/api/auth/github/start?returnPath=%2F");
  }

  function handleGitHubSignIn() {
    setIsAppMenuOpen(false);
    if (isDirtyRef.current || tagInput.trim().length > 0) {
      setCloudDialog("sign-in");
      return;
    }
    navigateToGitHubSignIn();
  }

  function closeCloudDialog() {
    const returnToRestore = cloudDialog === "restore";
    setCloudDialog(null);
    if (!returnToRestore) {
      window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
    }
  }

  async function confirmCloudDialog() {
    if (cloudDialog === "sign-in") {
      const saved = await handleSave();
      if (saved) {
        setCloudDialog(null);
        navigateToGitHubSignIn();
      } else {
        closeCloudDialog();
        window.requestAnimationFrame(() => bodyRef.current?.focus());
      }
      return;
    }
    if (cloudDialog === "backup") {
      const saved = await handleSave();
      if (saved) {
        setCloudDialog(null);
        await beginCloudBackup();
      } else {
        closeCloudDialog();
        window.requestAnimationFrame(() => bodyRef.current?.focus());
      }
      return;
    }
    if (cloudDialog === "restore") {
      const saved = await handleSave();
      if (saved) {
        setCloudDialog(null);
        await applyCloudRestore();
      } else {
        closeCloudDialog();
        window.requestAnimationFrame(() => bodyRef.current?.focus());
      }
      return;
    }
    if (cloudDialog === "disconnect") {
      await githubSession.disconnect();
      setCloudDialog(null);
      setIsAppMenuOpen(true);
      window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
    }
  }

  async function handleGitHubSignOut() {
    await githubSession.signOut();
    window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
  }

  async function handleGitHubSessionReset() {
    await githubSession.resetSession();
    window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
  }

  function handleGitHubDisconnect() {
    setIsAppMenuOpen(false);
    setCloudDialog("disconnect");
  }

  function closeCloudBackupDialog() {
    setCloudBackupDialog(null);
    setCloudBackupDialogError(null);
    window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
  }

  async function openCloudEncryptionDialog(hasExistingBackup: boolean) {
    try {
      const savedNotes = await getAllNotes();
      setCloudBackupDialogError(null);
      setCloudBackupDialog(
        hasExistingBackup && savedNotes.length === 0
          ? "empty-warning"
          : "passphrase"
      );
    } catch {
      setDbError("Local notes could not be read for cloud backup.");
      setIsAppMenuOpen(true);
    }
  }

  async function beginCloudBackup() {
    const currentSession = await githubSession.refresh();
    if (currentSession.status !== "signed-in") {
      setIsAppMenuOpen(true);
      return;
    }
    const resolution = await cloudBackup.discover(
      cloudBackup.storedMetadata?.gistId
    );
    if (!resolution) {
      setIsAppMenuOpen(true);
      return;
    }
    if (resolution.status === "selection-required") {
      setCloudBackupDialogError(null);
      setCloudBackupDialog("selection");
      return;
    }
    if (resolution.status === "none" || resolution.status === "selected") {
      await openCloudEncryptionDialog(resolution.status === "selected");
    }
  }

  async function retryCloudCheck() {
    const currentSession = await githubSession.refresh();
    if (currentSession.status !== "signed-in") return;
    await cloudBackup.discover(cloudBackup.storedMetadata?.gistId);
  }

  function handleCloudBackupStart() {
    setIsAppMenuOpen(false);
    githubSession.clearNotice();
    cloudBackup.clearNotice();
    if (isDirtyRef.current || tagInput.trim().length > 0) {
      setCloudDialog("backup");
      return;
    }
    void beginCloudBackup();
  }

  async function selectCloudBackupCandidate(gistId: string) {
    setCloudBackupDialogError(null);
    try {
      await cloudBackup.selectCandidate(gistId);
      await openCloudEncryptionDialog(true);
    } catch (error) {
      setCloudBackupDialogError(
        error instanceof Error
          ? error.message
          : "The selected cloud backup could not be verified."
      );
    }
  }

  async function submitCloudBackup(
    passphrase: string,
    confirmation: string
  ) {
    setCloudBackupDialogError(null);
    try {
      await cloudBackup.upload(passphrase, confirmation);
      setCloudBackupDialog(null);
      setIsAppMenuOpen(true);
      window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
    } catch (error) {
      if (
        error instanceof CloudApiError &&
        error.code === "REMOTE_REVISION_CHANGED"
      ) {
        setCloudBackupDialog("conflict");
        return;
      }
      setCloudBackupDialogError(
        error instanceof Error
          ? error.message
          : "Cloud backup could not be completed."
      );
    }
  }

  async function replaceChangedCloudBackup() {
    if (cloudBackup.discovery.status !== "selected") {
      setCloudBackupDialogError("The latest cloud backup could not be identified.");
      return;
    }
    setCloudBackupDialogError(null);
    try {
      await cloudBackup.selectCandidate(cloudBackup.discovery.backup.gistId);
      await openCloudEncryptionDialog(true);
    } catch (error) {
      setCloudBackupDialogError(
        error instanceof Error
          ? error.message
          : "The latest cloud backup could not be verified."
      );
    }
  }

  function closeCloudRestoreDialog() {
    cloudRestore.clear();
    setCloudRestoreDialog(null);
    setCloudRestoreDialogError(null);
    setIsAppMenuOpen(true);
    window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
  }

  async function downloadCloudRestore(gistId: string) {
    setCloudRestoreDialogError(null);
    setCloudRestoreDialog("downloading");
    try {
      const downloaded = await cloudRestore.download(gistId);
      if (downloaded) setCloudRestoreDialog("passphrase");
    } catch (error) {
      setCloudRestoreDialogError(
        error instanceof Error
          ? error.message
          : "Cloud backup could not be downloaded."
      );
    }
  }

  async function beginCloudRestore() {
    const currentSession = await githubSession.refresh();
    if (currentSession.status !== "signed-in") {
      setIsAppMenuOpen(true);
      return;
    }
    const resolution = await cloudBackup.discover(
      cloudBackup.storedMetadata?.gistId
    );
    if (!resolution) {
      setIsAppMenuOpen(true);
      return;
    }
    if (resolution.status === "selection-required") {
      setCloudRestoreDialogError(null);
      setCloudRestoreDialog("selection");
      return;
    }
    if (resolution.status === "none") {
      setCloudRestoreDialog("none");
      return;
    }
    if (resolution.status === "selected") {
      await downloadCloudRestore(resolution.backup.gistId);
    }
  }

  function handleCloudRestoreStart() {
    setIsAppMenuOpen(false);
    githubSession.clearNotice();
    cloudBackup.clearNotice();
    cloudRestore.clear();
    setCloudRestoreDialogError(null);
    void beginCloudRestore();
  }

  async function selectCloudRestoreCandidate(gistId: string) {
    setCloudRestoreDialogError(null);
    try {
      const selected = await cloudBackup.selectCandidate(gistId);
      await downloadCloudRestore(selected.gistId);
    } catch (error) {
      setCloudRestoreDialogError(
        error instanceof Error
          ? error.message
          : "The selected cloud backup could not be verified."
      );
    }
  }

  async function submitCloudRestorePassphrase(passphrase: string) {
    setCloudRestoreDialogError(null);
    try {
      await cloudRestore.prepare(passphrase);
      setCloudRestoreDialog("preview");
    } catch (error) {
      setCloudRestoreDialogError(
        error instanceof Error
          ? error.message
          : "Cloud backup could not be decrypted."
      );
    }
  }

  async function applyCloudRestore() {
    setCloudRestoreDialogError(null);
    try {
      await cloudRestore.apply();
      const restoredNotes = sortNotes(await getAllNotes());
      setNotes(restoredNotes);
      setDbError(dbInitError);
      if (selectedId) {
        const restoredSelection = restoredNotes.find(
          (note) => note.id === selectedId
        );
        if (restoredSelection) resetDraft(restoredSelection);
      }
      setCloudRestoreDialog("result");
    } catch (error) {
      setCloudRestoreDialogError(
        error instanceof Error
          ? error.message
          : "Cloud restore could not be applied."
      );
      if (error instanceof CloudRestoreApplyError) {
        setCloudRestoreDialog("result");
      }
    }
  }

  function handleCloudRestoreApply() {
    if (isDirtyRef.current || tagInput.trim().length > 0) {
      setCloudDialog("restore");
      return;
    }
    void applyCloudRestore();
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
        cloudDialog !== null ||
        cloudBackupDialog !== null ||
        cloudRestoreDialog !== null ||
        isFilterDialogOpen ||
        operationDialog !== null ||
        deleteConfirmation !== null ||
        revertConfirmation !== null ||
        isMetadataDialogOpen ||
        isPwaInstallHelpOpen ||
        isPwaUpdateDialogOpen;
      if (event.repeat || saveStatus === "saving" || isDialogOpen ||
          (isSaveShortcut && styledExportSnapshot !== null)) {
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
    setOpenNoteCardMenuId(null);
    setNoteCardMenuPosition(null);
    const canContinue = await confirmUnsavedTransition("open another note");
    if (!canContinue) {
      return;
    }
    setPendingNoteListRevealId(null);
    setSelectedId(note.id);
    resetDraft(note);
    setMobileView("editor");
    setPreviewMountedForNoteId(note.id);
    setActiveTab("preview");
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
    const targetIsVisibleInCurrentFilter = filterNotes(notes, {
      query: searchQuery,
      tags: activeTagFilterValues,
    }).some((note) => note.id === targetNote.id);
    setPreviewLinkNotice(
      targetIsVisibleInCurrentFilter
        ? null
        : `Linked note is hidden by the current filter: ${targetNote.title}`
    );
    setPendingNoteListRevealId(targetNote.id);
    setIsEditorExpanded(false);
    setSelectedId(targetNote.id);
    resetDraft(targetNote);
    setMobileView("editor");
    setActiveTab("preview");
    setPreviewMountedForNoteId(targetNote.id);
    setSlideIndex(0);
  };

  const handleTocItemClick = (item: TocItem) => {
    const preview = previewRef.current;
    const heading = preview?.querySelector<HTMLElement>(
      `[data-toc-index="${item.index}"]`
    );
    if (!preview || !heading) {
      closeToc({ immediate: true });
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const behavior: ScrollBehavior = reducedMotion ? "auto" : "smooth";
    const isMobile = window.matchMedia("(max-width: 900px)").matches;

    if (isMobile) {
      const header = document.querySelector<HTMLElement>(".editor-header");
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const top = Math.max(
        0,
        window.scrollY +
          heading.getBoundingClientRect().top -
          headerBottom -
          12
      );
      window.scrollTo({ top, behavior });
    } else {
      const previewRect = preview.getBoundingClientRect();
      const headingRect = heading.getBoundingClientRect();
      const top = Math.max(
        0,
        preview.scrollTop + headingRect.top - previewRect.top - 12
      );
      preview.scrollTo({ top, behavior });
      previewScrollTopRef.current = top;
      previewAnchorRef.current = { element: heading, offsetTop: 12 };
    }

    closeToc();
    heading.focus({ preventScroll: true });
  };

  const handleChangeTab = (nextTab: ActiveTab) => {
    if (activeTab === "edit" && bodyRef.current) {
      editScrollTopRef.current =
        bodyRef.current.getSelectionSnapshot()?.scrollTop ?? 0;
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

  const closeMetadataDialog = () => {
    setIsMetadataDialogOpen(false);
    window.requestAnimationFrame(() => actionsMenuButtonRef.current?.focus());
  };

  const applyMetadata = (entries: CustomMetadataEntry[]) => {
    const nextEntries = cloneCustomMetadata(entries);
    if (!areCustomMetadataEqual(draftCustomMetadata, nextEntries)) {
      setDraftCustomMetadata(nextEntries);
      markDirty();
    }
    closeMetadataDialog();
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
        !areCustomMetadataEqual(
          draftCustomMetadata,
          initialDraft.customMetadata
        ) ||
        hasPendingTagInput
      : false;
  const canRevertDraft =
    selectedId !== null &&
    (selectedNote ? hasDraftChanges : isDraftDifferentFromInitial);

  const handleRevertDraft = () => {
    if (!canRevertDraft) {
      return;
    }

    setRevertConfirmation({
      target: selectedNote ? "saved-note" : "initial-draft",
    });
  };

  const closeRevertConfirmation = () => {
    setRevertConfirmation(null);
    window.requestAnimationFrame(() => revertButtonRef.current?.focus());
  };

  const confirmRevertDraft = () => {
    if (!revertConfirmation) {
      return;
    }

    const target = revertConfirmation.target;
    setRevertConfirmation(null);

    if (target === "saved-note" && selectedNote) {
      resetDraft(selectedNote);
      return;
    }

    if (target === "initial-draft" && isDraftNote && initialDraft) {
      setSelectedId(initialDraft.id);
      setDraftTitle(initialDraft.title);
      setDraftTags(initialDraft.tags);
      setTagInput("");
      closeTagSuggestions();
      setDraftBody(initialDraft.body);
      setBodyEditorResetKey((current) => current + 1);
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
      setDraftCustomMetadata(cloneCustomMetadata(initialDraft.customMetadata));
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
  const pendingNoteListRevealIsVisible =
    pendingNoteListRevealId !== null &&
    filteredNotes.some((note) => note.id === pendingNoteListRevealId);

  useLayoutEffect(() => {
    if (!pendingNoteListRevealId) {
      return;
    }

    if (!pendingNoteListRevealIsVisible) {
      return;
    }

    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    if (isMobile && mobileView !== "notes") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const list = noteListRef.current;
      const noteButton = Array.from(
        list?.querySelectorAll<HTMLButtonElement>(".note-card-select") ?? []
      ).find((button) => button.dataset.noteId === pendingNoteListRevealId);
      const card = noteButton?.closest<HTMLElement>(".note-item");
      if (!list || !card || list.clientHeight === 0) {
        return;
      }

      const listRect = list.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      let targetScrollTop = list.scrollTop;
      if (cardRect.top < listRect.top) {
        targetScrollTop += cardRect.top - listRect.top;
      } else if (cardRect.bottom > listRect.bottom) {
        targetScrollTop += cardRect.bottom - listRect.bottom;
      }

      if (targetScrollTop !== list.scrollTop) {
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;
        list.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: reducedMotion ? "auto" : "smooth",
        });
      }

      setPendingNoteListRevealId(null);
      setPreviewLinkNotice(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    mobileView,
    pendingNoteListRevealId,
    pendingNoteListRevealIsVisible,
  ]);
  const openNoteCardMenuNote =
    openNoteCardMenuId
    ? filteredNotes.find((note) => note.id === openNoteCardMenuId) ?? null
    : null;
  const filterDraftPreviewCount = filterNotes(notes, {
    query: filterDraftSearchQuery,
    tags: filterDraftTags,
  }).length;
  const noteCountText = hasActiveFilters
    ? `${filteredNotes.length} of ${notes.length}`
    : `${notes.length}`;
  const noteCountAccessibleLabel = hasActiveFilters
    ? `${filteredNotes.length} of ${notes.length} ${
        notes.length === 1 ? "note" : "notes"
      }`
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

  const resetNoteListScroll = () => {
    window.requestAnimationFrame(() => {
      if (noteListRef.current) {
        noteListRef.current.scrollTop = 0;
      }
    });
  };

  const applyFilterDialog = () => {
    setSearchQuery(filterDraftSearchQuery);
    setTagFilter(filterDraftTags.join(", "));
    closeFilterDialog();
    resetNoteListScroll();
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
    resetNoteListScroll();
    window.requestAnimationFrame(() => filterButtonRef.current?.focus());
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

  const focusNoteCardActionOrigin = (noteId: string) => {
    window.requestAnimationFrame(() => {
      const trigger = noteCardMenuButtonRef.current;
      if (trigger?.isConnected) {
        trigger.focus();
        return;
      }

      const noteButton = Array.from(
        noteListRef.current?.querySelectorAll<HTMLButtonElement>(
          ".note-card-select"
        ) ?? []
      ).find((button) => button.dataset.noteId === noteId);
      noteButton?.focus();
    });
  };

  const handleNotePinChange = async (note: Note, shouldPin: boolean) => {
    if (noteCardActionBusyId !== null) {
      return;
    }

    const nextNote: Note = { ...note };
    if (shouldPin) {
      nextNote.pinnedAt = getCurrentTimestamp();
    } else {
      delete nextNote.pinnedAt;
    }

    setNoteCardActionBusyId(note.id);
    try {
      await saveNote(nextNote);
      setNotes((prev) =>
        sortNotes(
          prev.map((item) => (item.id === nextNote.id ? nextNote : item))
        )
      );
      setDbError(dbInitError);
      setOpenNoteCardMenuId(null);
      setNoteCardMenuPosition(null);
      focusNoteCardActionOrigin(note.id);
    } catch (error) {
      setDbError(
        getErrorMessage(
          error,
          shouldPin ? "Failed to pin the note." : "Failed to unpin the note."
        )
      );
    } finally {
      setNoteCardActionBusyId(null);
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

    setDeleteConfirmation({ note: targetNote, focusTarget: "editor-actions" });
  };

  const handleNoteCardDelete = (note: Note) => {
    const targetNote =
      note.id === selectedId &&
      (isDirtyRef.current || tagInput.trim().length > 0)
        ? getDraftSnapshot()
        : note;

    setOpenNoteCardMenuId(null);
    setNoteCardMenuPosition(null);
    setDeleteConfirmation({ note: targetNote, focusTarget: "note-card" });
  };

  const closeDeleteConfirmation = () => {
    const focusTarget = deleteConfirmation?.focusTarget;
    const noteId = deleteConfirmation?.note.id;
    setDeleteConfirmation(null);
    window.requestAnimationFrame(() => {
      if (focusTarget === "note-card" && noteId) {
        focusNoteCardActionOrigin(noteId);
        return;
      }
      actionsMenuButtonRef.current?.focus();
    });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation) {
      return;
    }

    const targetNote = deleteConfirmation.note;
    setDeleteConfirmation(null);
    if (pendingNoteListRevealId === targetNote.id) {
      setPendingNoteListRevealId(null);
    }

    await finalizePendingDelete();

    const persistedIndex = notes.findIndex(
      (note) => note.id === targetNote.id
    );
    const restoreIndex = Math.max(persistedIndex, 0);
    const wasDraft = persistedIndex < 0;
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

  const handlePrint = async () => {
    if ((!selectedNote && !isDraftNote) || isPrintPreparing) {
      return;
    }

    const printSurface = printSurfaceRef.current;
    if (!printSurface) {
      return;
    }

    setIsPrintPreparing(true);
    await waitForPrintableContent(printSurface);

    const previousTitle = document.title;
    const restoreAfterPrint = () => {
      document.title = previousTitle;
      setIsPrintPreparing(false);
      window.removeEventListener("afterprint", restoreAfterPrint);
    };

    document.title = `${sanitizeDownloadName(draftTitle.trim() || "Untitled")} - Markdown Knowledge Board`;
    window.addEventListener("afterprint", restoreAfterPrint);
    try {
      window.print();
    } catch {
      restoreAfterPrint();
    }
  };

  const openStyledExport = () => {
    if (!selectedNote && !isDraftNote) return;
    const note = getDraftSnapshot();
    setIsEditorExpanded(false);
    setStyledExportSnapshot({ title: note.title, body: note.body, tags: [...note.tags] });
    setIsActionsMenuOpen(false);
  };

  const closeStyledExport = () => {
    setStyledExportSnapshot(null);
    setActiveTab("preview");
    window.requestAnimationFrame(() => previewTabButtonRef.current?.focus());
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
      operationDialogReturnFocusRef.current = appMenuButtonRef.current;
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

  const pwaStatusHiddenForDialog =
    unsavedDialog !== null ||
    cloudDialog !== null ||
    cloudBackupDialog !== null ||
    cloudRestoreDialog !== null ||
    isFilterDialogOpen ||
    operationDialog !== null ||
    deleteConfirmation !== null ||
    revertConfirmation !== null ||
    isMetadataDialogOpen ||
    isPwaInstallHelpOpen ||
    isPwaUpdateDialogOpen;
  const pwaUpdateBlocked =
    saveStatus === "saving" ||
    githubSession.busyAction !== null ||
    cloudBackup.uploading ||
    cloudRestore.downloading ||
    cloudRestore.preparing ||
    cloudRestore.applying ||
    isBackupBusy ||
    isImporting;

  const restorePwaUpdateFocus = () => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>("[data-pwa-update-action]")
        ?.focus();
    });
  };

  const handlePwaInstall = async () => {
    setIsAppMenuOpen(false);
    await pwa.promptInstall();
    window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
  };

  const openPwaInstallHelp = () => {
    setIsAppMenuOpen(false);
    setIsPwaInstallHelpOpen(true);
  };

  const closePwaInstallHelp = () => {
    setIsPwaInstallHelpOpen(false);
    window.requestAnimationFrame(() => appMenuButtonRef.current?.focus());
  };

  const handlePwaRestart = () => {
    if (pwaUpdateBlocked) {
      return;
    }
    setIsAppMenuOpen(false);
    if (isDirtyRef.current || tagInput.trim().length > 0) {
      setIsPwaUpdateDialogOpen(true);
      return;
    }
    void pwa.applyUpdate();
  };

  const handlePwaSaveAndRestart = async () => {
    if (saveStatus === "saving") {
      return;
    }
    const saved = await handleSave();
    if (!saved) {
      return;
    }
    await pwa.applyUpdate();
    setIsPwaUpdateDialogOpen(false);
  };

  const cancelPwaUpdate = () => {
    setIsPwaUpdateDialogOpen(false);
    restorePwaUpdateFocus();
  };

  return (
    <div
      className={`app mobile-${mobileView}${
        isEditorExpanded ? " editor-expanded" : ""
      }`}
      style={
        {
          "--content-font-scale": contentFontScale / 100,
        } as CSSProperties
      }
    >
      <header className="editor-header">
        <div className="editor-title-row">
          <div className="app-menu" ref={appMenuRef}>
            <button
              ref={appMenuButtonRef}
              className="app-menu-button quiet-icon-button tooltip-button"
              type="button"
              aria-label="Open application menu"
              data-tooltip="Open application menu"
              aria-haspopup="menu"
              aria-expanded={isAppMenuOpen}
              aria-controls="application-menu"
              onClick={() => {
                if (isAppMenuOpen) {
                  setIsAppMenuOpen(false);
                  return;
                }
                setAppMenuView("root");
                setIsAppMenuOpen(true);
              }}
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
                {appMenuView === "root" ? (
                  <>
                    <button
                      ref={localDataMenuItemRef}
                      className="app-menu-item app-menu-category"
                      type="button"
                      role="menuitem"
                      aria-label="Local Data"
                      aria-haspopup="menu"
                      onClick={() => {
                        setAppMenuView("local");
                        window.requestAnimationFrame(() =>
                          appMenuBackButtonRef.current?.focus()
                        );
                      }}
                    >
                      <HardDrive aria-hidden="true" />
                      <span className="app-menu-category-content">
                        <span>Local Data</span>
                        <span>Backup and import</span>
                      </span>
                      <ChevronRight
                        className="app-menu-category-chevron"
                        aria-hidden="true"
                      />
                    </button>
                    {cloudCapability.status === "enabled" ? (
                      <button
                        ref={githubMenuItemRef}
                        className="app-menu-item app-menu-category"
                        type="button"
                        role="menuitem"
                        aria-label="GitHub"
                        aria-haspopup="menu"
                        onClick={() => {
                          setAppMenuView("github");
                          window.requestAnimationFrame(() =>
                            appMenuBackButtonRef.current?.focus()
                          );
                        }}
                      >
                        <Cloud aria-hidden="true" />
                        <span className="app-menu-category-content">
                          <span>GitHub</span>
                          <span>Cloud backup and account</span>
                        </span>
                        <ChevronRight
                          className="app-menu-category-chevron"
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                    {pwa.snapshot.registration === "ready" &&
                    pwa.snapshot.install === "available" ? (
                      <button
                        ref={pwaInstallMenuItemRef}
                        className="app-menu-item"
                        type="button"
                        role="menuitem"
                        onClick={() => void handlePwaInstall()}
                      >
                        <Download aria-hidden="true" />
                        Install App
                      </button>
                    ) : null}
                    {pwa.snapshot.registration === "ready" &&
                    pwa.snapshot.install === "ios-help" ? (
                      <button
                        ref={pwaInstallHelpMenuItemRef}
                        className="app-menu-item"
                        type="button"
                        role="menuitem"
                        onClick={openPwaInstallHelp}
                      >
                        <Smartphone aria-hidden="true" />
                        Install Help
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button
                      ref={appMenuBackButtonRef}
                      className="app-menu-item app-menu-back"
                      type="button"
                      role="menuitem"
                      aria-label="Back to application menu"
                      onClick={() => {
                        const returnFocusRef =
                          appMenuView === "local"
                            ? localDataMenuItemRef
                            : githubMenuItemRef;
                        setAppMenuView("root");
                        window.requestAnimationFrame(() =>
                          returnFocusRef.current?.focus()
                        );
                      }}
                    >
                      <ChevronLeft aria-hidden="true" />
                      Application menu
                    </button>
                    <div
                      className="app-menu-section-label app-menu-submenu-title"
                      role="presentation"
                    >
                      {appMenuView === "local" ? "Local Data" : "GitHub"}
                    </div>
                    {appMenuView === "local" ? (
                      <>
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
                            <span>
                              {isBackupBusy
                                ? "Creating Backup"
                                : "Backup All Notes"}
                            </span>
                            <span className="backup-last-label">
                              Last local backup
                            </span>
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
                      </>
                    ) : (
                      <GitHubSection
                        session={githubSession.session}
                        isOnline={githubSession.isOnline}
                        isSecondaryOrigin={
                          cloudCapability.status === "enabled" &&
                          cloudCapability.isSecondaryOrigin
                        }
                        notice={githubSession.notice}
                        busyAction={githubSession.busyAction}
                        cloudBackup={{
                          discovery: cloudBackup.discovery,
                          storedMetadata: cloudBackup.storedMetadata,
                          notice: cloudBackup.notice,
                          uploading: cloudBackup.uploading,
                          restoring:
                            cloudRestore.downloading ||
                            cloudRestore.preparing ||
                            cloudRestore.applying,
                        }}
                        onSignIn={handleGitHubSignIn}
                        onRetry={() => void githubSession.retry()}
                        onSignOut={() => void handleGitHubSignOut()}
                        onDisconnect={handleGitHubDisconnect}
                        onResetSession={() => void handleGitHubSessionReset()}
                        onCloudBackup={handleCloudBackupStart}
                        onCloudRestore={handleCloudRestoreStart}
                        onCloudRetry={() => void retryCloudCheck()}
                      />
                    )}
                  </>
                )}
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
            aria-keyshortcuts={styledExportSnapshot ? undefined : "Control+S Meta+S"}
            data-tooltip={saveTooltip}
            onClick={handleSave}
            disabled={styledExportSnapshot !== null || saveStatus === "saving"}
          >
            {saveStatus === "saving" ? "Saving" : "Save"}
          </button>
          <button
            ref={revertButtonRef}
            className="secondary-button icon-action-button quiet-icon-button tooltip-button"
            type="button"
            aria-label="Revert changes"
            data-tooltip="Revert changes"
            onClick={handleRevertDraft}
            disabled={styledExportSnapshot !== null || !canRevertDraft}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <div className="actions-menu" ref={actionsMenuRef}>
            <button
              ref={actionsMenuButtonRef}
              className="secondary-button icon-action-button quiet-icon-button tooltip-button"
              type="button"
              aria-label="More actions"
              data-tooltip="More actions"
              aria-haspopup="menu"
              aria-expanded={isActionsMenuOpen}
              aria-controls="note-actions-menu"
              disabled={styledExportSnapshot !== null || (!selectedNote && !isDraftNote)}
              onClick={() => {
                setOpenNoteCardMenuId(null);
                setNoteCardMenuPosition(null);
                setIsActionsMenuOpen((open) => !open);
              }}
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
                    setIsMetadataDialogOpen(true);
                  }}
                >
                  <Braces aria-hidden="true" />
                  Metadata
                </button>
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
                  Export Markdown
                </button>
                <button
                  className="actions-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={isPrintPreparing}
                  onClick={() => {
                    setIsActionsMenuOpen(false);
                    void handlePrint();
                  }}
                >
                  <FileDown aria-hidden="true" />
                  {isPrintPreparing ? "Preparing PDF..." : "Print / PDF"}
                </button>
                <button
                  className="actions-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={openStyledExport}
                >
                  <FileDown aria-hidden="true" />
                  <span className="actions-menu-item-label">
                    Export Styled HTML / PDF…
                  </span>
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
      <PwaStatusRegion
        snapshot={pwa.snapshot}
        hiddenForDialog={pwaStatusHiddenForDialog}
        updateBlocked={pwaUpdateBlocked}
        onRestart={handlePwaRestart}
        onLater={pwa.deferUpdate}
      />
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
            ref={markdownImportButtonRef}
            className="markdown-import-button quiet-icon-button tooltip-button"
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
            <div className="notes-heading">
              <div className="section-title">Notes</div>
              <div
                className="note-count"
                aria-label={noteCountAccessibleLabel}
                aria-live="polite"
              >
                ({noteCountText})
              </div>
            </div>
            <div className="notes-filter-actions">
              <button
                className={`filter-button${hasActiveFilters ? " active" : ""}`}
                ref={filterButtonRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isFilterDialogOpen}
                onClick={openFilterDialog}
              >
                <FilterIcon
                  className="filter-button-icon"
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <span className="filter-button-label">
                  {hasActiveFilters
                    ? `Filter · ${activeFilterCount}`
                    : "Filter"}
                </span>
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
          <ul ref={noteListRef} className="note-list">
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
                  }${isNotePinned(note) ? " pinned" : ""}${
                    note.id === selectedId || isNotePinned(note)
                      ? " has-card-action"
                      : ""
                  }`}
                  data-pinned={isNotePinned(note) || undefined}
                  data-menu-open={openNoteCardMenuId === note.id || undefined}
                >
                  <button
                    className="note-card-select"
                    type="button"
                    data-note-id={note.id}
                    aria-label={`Open note: ${note.title || "Untitled"}`}
                    aria-current={note.id === selectedId ? "true" : undefined}
                    onClick={() => void handleSelectNote(note)}
                  >
                    <span
                      className="note-title"
                      title={note.title || "Untitled"}
                    >
                      {note.title || "Untitled"}
                    </span>
                    {note.tags.length > 0 ? (
                      <span className="note-tags">
                        {note.tags.map((tag) => (
                          <span className="note-tag" key={tag} title={tag}>
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="note-meta">
                      {formatDate(note.updatedAt)}
                    </span>
                  </button>
                  {note.id === selectedId || isNotePinned(note) ? (
                    <button
                      className={`note-card-menu-trigger${
                        isNotePinned(note) ? " is-pinned" : ""
                      }`}
                      type="button"
                      aria-label={
                        isNotePinned(note)
                          ? `Pinned note actions: ${note.title || "Untitled"}`
                          : "Selected note actions"
                      }
                      title={
                        isNotePinned(note) ? "Pinned note actions" : "More actions"
                      }
                      aria-haspopup="menu"
                      aria-expanded={openNoteCardMenuId === note.id}
                      aria-controls={
                        openNoteCardMenuId === note.id
                          ? "note-card-actions-menu"
                          : undefined
                      }
                      onClick={(event) => {
                        noteCardMenuButtonRef.current = event.currentTarget;
                        setIsActionsMenuOpen(false);
                        setNoteCardMenuPosition(null);
                        setOpenNoteCardMenuId((current) =>
                          current === note.id ? null : note.id
                        );
                      }}
                    >
                      {isNotePinned(note) ? (
                        <Pin aria-hidden="true" />
                      ) : (
                        <MoreVertical aria-hidden="true" />
                      )}
                    </button>
                  ) : null}
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
        {styledExportSnapshot ? (
          <StyledExportView
            snapshot={styledExportSnapshot}
            onBackToPreview={closeStyledExport}
          />
        ) : null}
        <div
          className="editor-workspace"
          hidden={styledExportSnapshot !== null}
        >
        <div className="editor-tabs">
          <button
            ref={previewTabButtonRef}
            type="button"
            className={`tab-button${activeTab === "preview" ? " active" : ""}`}
            aria-pressed={activeTab === "preview"}
            onClick={() => handleChangeTab("preview")}
          >
            Preview
          </button>
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
          {activeTab === "preview" ? (
            <div
              className={`preview-toc${isTocRendered ? " is-open" : ""}`}
              ref={tocRootRef}
            >
              <span
                className="preview-toc-trigger tooltip-button"
                data-tooltip={
                  tocItems.length === 0 ? "No headings" : "Table of contents"
                }
              >
                <button
                  ref={tocButtonRef}
                  type="button"
                  className="preview-toc-button quiet-icon-button"
                  aria-label="Table of contents"
                  aria-expanded={isTocOpen}
                  aria-controls="preview-toc-popover"
                  disabled={tocItems.length === 0}
                  onClick={(event) => {
                    if (isTocOpen) {
                      closeToc();
                    } else {
                      openToc(event.detail === 0);
                    }
                  }}
                >
                  <ListTree aria-hidden="true" />
                </button>
              </span>
              {isTocRendered ? (
                <nav
                  id="preview-toc-popover"
                  className="preview-toc-popover"
                  data-state={tocVisibility}
                  aria-label="Table of contents"
                >
                  <div className="preview-toc-header">Table of contents</div>
                  <ol className="preview-toc-list">
                    {tocItems.map((item, index) => (
                      <li key={item.key}>
                        <button
                          ref={index === 0 ? tocFirstItemRef : undefined}
                          type="button"
                          className="preview-toc-item"
                          data-level={item.level}
                          aria-label={`Heading level ${item.level}: ${item.text}`}
                          onClick={() => handleTocItemClick(item)}
                        >
                          {item.text}
                        </button>
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : null}
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
            }${isImportDragActive ? " is-drag-active" : ""}`}
            onDragEnter={handleImportDragEnter}
            onDragOver={handleImportDragOver}
            onDragLeave={handleImportDragLeave}
            // Capture file drops before CodeMirror inserts their text into the document.
            onDropCapture={handleImportDrop}
          >
            <div className="body-header">
              <div className="label" id="body-label">
                Body
              </div>
              <div className="md-toolbar" role="toolbar" aria-label="Markdown tools">
                <MarkdownToolbarMenu
                  menuId="format"
                  label="Format"
                  isOpen={openMarkdownMenu === "format"}
                  items={formatMenuItems}
                  onBeforeOpen={captureEditorSelection}
                  onOpenChange={handleMarkdownMenuOpenChange}
                  onSelect={executeMarkdownCommand}
                />
                <MarkdownToolbarMenu
                  menuId="paragraph"
                  label="Paragraph"
                  isOpen={openMarkdownMenu === "paragraph"}
                  items={paragraphMenuItems}
                  onBeforeOpen={captureEditorSelection}
                  onOpenChange={handleMarkdownMenuOpenChange}
                  onSelect={executeMarkdownCommand}
                />
                <MarkdownToolbarMenu
                  menuId="insert"
                  label="Insert"
                  isOpen={openMarkdownMenu === "insert"}
                  items={insertMenuItems}
                  onBeforeOpen={captureEditorSelection}
                  onOpenChange={handleMarkdownMenuOpenChange}
                  onSelect={executeMarkdownCommand}
                />
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
            <MarkdownBodyEditor
              labelledBy="body-label"
              noteId={selectedId}
              onChange={(nextBody) => {
                setDraftBody(nextBody);
                markDirty();
              }}
              onSelectionChange={(snapshot) => {
                editorSelectionRef.current = snapshot;
                setEditorSelection(snapshot);
              }}
              placeholder="Write markdown here..."
              ref={bodyRef}
              resetKey={bodyEditorResetKey}
              value={draftBody}
            />
          </div>
        {activeTab === "preview" ||
        (selectedId !== null && previewMountedForNoteId === selectedId) ? (
          <div
            hidden={activeTab !== "preview"}
            className={`preview-panel editor-body${
              isImportDragActive ? " is-drag-active" : ""
            }`}
            onDragEnter={handleImportDragEnter}
            onDragOver={handleImportDragOver}
            onDragLeave={handleImportDragLeave}
            onDropCapture={handleImportDrop}
          >
            {draftBody.trim().length === 0 ? (
              <div className="preview-empty">Nothing to preview.</div>
            ) : (
              <MarkdownPreview
                markdown={draftBody}
                previewRef={previewRef}
                onPreviewLinkClick={(event, href) => {
                  const targetTitle = getPreviewNoteLinkTitle(href);
                  if (!targetTitle) {
                    return;
                  }
                  event.preventDefault();
                  void handlePreviewNoteLink(targetTitle);
                }}
                onTaskToggle={(lineIndex) => {
                  const currentBody = bodyRef.current?.getValue() ?? draftBody;
                  const nextBody = toggleTaskAtLine(currentBody, lineIndex);
                  if (bodyRef.current) {
                    bodyRef.current.replaceValue(nextBody, {
                      addToHistory: true,
                    });
                  } else {
                    setDraftBody(nextBody);
                    markDirty();
                  }
                }}
              />
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
        </div>
      </main>
      </div>
      <div ref={printSurfaceRef} className="print-surface" aria-hidden="true">
        <article className="print-document">
          <header className="print-document-header">
            <h1>{draftTitle.trim() || "Untitled"}</h1>
            {draftTags.length > 0 ? (
              <ul className="print-document-tags">
                {draftTags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : null}
          </header>
          {draftBody.trim().length === 0 ? (
            <p className="print-empty">Nothing to preview.</p>
          ) : (
            <MarkdownPreview
              markdown={draftBody}
              mode="print"
              className="mdPreview print-mdPreview"
            />
          )}
        </article>
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
      {importChoiceDialog ? (
        <ImportChoiceDialog
          fileNames={importChoiceDialog.files.map((file) => file.name)}
          noteTitle={importChoiceDialog.targetNoteTitle}
          onAdd={() => void handleAddDroppedFiles()}
          onReplace={() => void handleReplaceCurrentNoteBody()}
          onCancel={closeImportChoiceDialog}
        />
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
      {cloudDialog ? (
        <CloudActionDialog
          kind={cloudDialog}
          busy={
            saveStatus === "saving" || githubSession.busyAction !== null
          }
          onConfirm={() => void confirmCloudDialog()}
          onCancel={closeCloudDialog}
        />
      ) : null}
      {cloudBackupDialog === "passphrase" ? (
        <CloudBackupDialog
          kind="passphrase"
          busy={cloudBackup.uploading}
          error={cloudBackupDialogError}
          onSubmit={(passphrase, confirmation) =>
            void submitCloudBackup(passphrase, confirmation)
          }
          onCancel={closeCloudBackupDialog}
        />
      ) : null}
      {cloudBackupDialog === "empty-warning" ? (
        <CloudBackupDialog
          kind="empty-warning"
          onConfirm={() => {
            setCloudBackupDialogError(null);
            setCloudBackupDialog("passphrase");
          }}
          onCancel={closeCloudBackupDialog}
        />
      ) : null}
      {cloudBackupDialog === "selection" &&
      cloudBackup.discovery.status === "selection-required" ? (
        <CloudBackupDialog
          kind="selection"
          busy={false}
          candidates={cloudBackup.discovery.candidates}
          error={cloudBackupDialogError}
          onSelect={(gistId) => void selectCloudBackupCandidate(gistId)}
          onCancel={closeCloudBackupDialog}
        />
      ) : null}
      {cloudBackupDialog === "conflict" ? (
        <CloudBackupDialog
          kind="conflict"
          busy={cloudBackup.discovery.status === "checking"}
          error={cloudBackupDialogError}
          onReplace={() => void replaceChangedCloudBackup()}
          onCancel={closeCloudBackupDialog}
        />
      ) : null}
      {cloudRestoreDialog === "downloading" && cloudDialog !== "restore" ? (
        <CloudRestoreDialog
          kind="downloading"
          busy={cloudRestore.downloading}
          error={cloudRestoreDialogError}
          onCancel={closeCloudRestoreDialog}
        />
      ) : null}
      {cloudRestoreDialog === "passphrase" && cloudDialog !== "restore" ? (
        <CloudRestoreDialog
          kind="passphrase"
          busy={cloudRestore.preparing}
          error={cloudRestoreDialogError}
          onSubmit={(passphrase) => void submitCloudRestorePassphrase(passphrase)}
          onCancel={closeCloudRestoreDialog}
        />
      ) : null}
      {cloudRestoreDialog === "selection" &&
      cloudBackup.discovery.status === "selection-required" &&
      cloudDialog !== "restore" ? (
        <CloudRestoreDialog
          kind="selection"
          candidates={cloudBackup.discovery.candidates}
          error={cloudRestoreDialogError}
          onSelect={(gistId) => void selectCloudRestoreCandidate(gistId)}
          onCancel={closeCloudRestoreDialog}
        />
      ) : null}
      {cloudRestoreDialog === "none" && cloudDialog !== "restore" ? (
        <CloudRestoreDialog kind="none" onClose={closeCloudRestoreDialog} />
      ) : null}
      {cloudRestoreDialog === "preview" &&
      cloudRestore.preview &&
      cloudDialog !== "restore" ? (
        <CloudRestoreDialog
          kind="preview"
          preview={cloudRestore.preview}
          busy={cloudRestore.applying}
          error={cloudRestoreDialogError}
          onApply={handleCloudRestoreApply}
          onCancel={closeCloudRestoreDialog}
        />
      ) : null}
      {cloudRestoreDialog === "result" &&
      cloudRestore.result &&
      cloudDialog !== "restore" ? (
        <CloudRestoreDialog
          kind="result"
          counts={cloudRestore.result}
          error={cloudRestoreDialogError}
          onClose={closeCloudRestoreDialog}
        />
      ) : null}
      {isMetadataDialogOpen ? (
        <MetadataDialog
          managedEntries={buildFrontmatterEntries(getDraftSnapshot()).filter(
            (entry) => entry.source !== "custom"
          )}
          customMetadata={draftCustomMetadata}
          onApply={applyMetadata}
          onClose={closeMetadataDialog}
        />
      ) : null}
      {isPwaInstallHelpOpen ? (
        <PwaInstallHelpDialog onClose={closePwaInstallHelp} />
      ) : null}
      {isPwaUpdateDialogOpen ? (
        <PwaUpdateDialog
          busy={saveStatus === "saving" || pwa.snapshot.update === "applying"}
          error={lastSaveError}
          onConfirm={() => void handlePwaSaveAndRestart()}
          onCancel={cancelPwaUpdate}
        />
      ) : null}
      {operationDialog ? (
        <div className="modal-backdrop">
          <div
            ref={operationDialogRef}
            className="result-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="operation-result-title"
            onKeyDown={handleOperationDialogKeyDown}
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
                ref={operationDialogCloseButtonRef}
                className="primary-button"
                type="button"
                onClick={closeOperationDialog}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {openNoteCardMenuNote
        ? createPortal(
            <div
              ref={noteCardMenuRef}
              id="note-card-actions-menu"
              className="actions-menu-popover note-card-menu-popover"
              role="menu"
              aria-label={`Actions for ${
                openNoteCardMenuNote.title || "Untitled"
              }`}
              aria-busy={
                noteCardActionBusyId === openNoteCardMenuNote.id || undefined
              }
              style={{
                top: noteCardMenuPosition?.top ?? 0,
                left: noteCardMenuPosition?.left ?? 0,
                visibility: noteCardMenuPosition ? "visible" : "hidden",
              }}
            >
              <button
                ref={noteCardMenuItemRef}
                className="actions-menu-item"
                type="button"
                role="menuitem"
                disabled={noteCardActionBusyId === openNoteCardMenuNote.id}
                onClick={() =>
                  void handleNotePinChange(
                    openNoteCardMenuNote,
                    !isNotePinned(openNoteCardMenuNote)
                  )
                }
              >
                {isNotePinned(openNoteCardMenuNote) ? (
                  <PinOff aria-hidden="true" />
                ) : (
                  <Pin aria-hidden="true" />
                )}
                {isNotePinned(openNoteCardMenuNote) ? "Unpin" : "Pin to top"}
              </button>
              <div className="actions-menu-separator" role="separator" />
              <button
                className="actions-menu-item actions-menu-item-danger"
                type="button"
                role="menuitem"
                disabled={noteCardActionBusyId === openNoteCardMenuNote.id}
                onClick={() => handleNoteCardDelete(openNoteCardMenuNote)}
              >
                <Trash2 aria-hidden="true" />
                Delete
              </button>
            </div>,
            document.body
          )
        : null}
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
      {revertConfirmation ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeRevertConfirmation();
            }
          }}
        >
          <div
            className="revert-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revert-dialog-title"
            aria-describedby="revert-dialog-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeRevertConfirmation();
              }
            }}
          >
            <h2 id="revert-dialog-title">Revert changes?</h2>
            <p id="revert-dialog-description">
              {revertConfirmation.target === "saved-note"
                ? "Your unsaved changes will be discarded and the last saved version will be restored."
                : "This draft will be restored to its initial state."}
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                autoFocus
                onClick={closeRevertConfirmation}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={confirmRevertDraft}
              >
                Revert Changes
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
      {contentFontScaleNotice !== null ? (
        <div
          className="content-font-scale-indicator"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          Text size: {contentFontScaleNotice}%
        </div>
      ) : null}
    </div>
  );
}

export default App;










