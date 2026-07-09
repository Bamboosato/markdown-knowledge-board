import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "./App.css";
import type { Note } from "./lib/types";
import { dbInitError, deleteNote, getAllNotes, saveNote } from "./lib/db";
import {
  parseMarkdownWithFrontmatter,
  toMarkdownWithFrontmatter,
} from "./lib/frontmatter";
import { insertLink, toggleLinePrefix, wrapSelection } from "./lib/markdownEdit";
import { getTaskLineIndexes, toggleTaskAtLine } from "./lib/markdownTasks";

type SaveStatus = "idle" | "draft" | "unsaved" | "saving" | "saved" | "error";
type MobileView = "notes" | "editor";
type UnsavedChoice = "save" | "discard" | "cancel";

type UnsavedDialogState = {
  actionLabel: string;
};

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
  return name.replace(/\.md$/i, "").trim();
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
  const items = value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return Array.from(new Set(items));
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function createBackupMessage(lastBackupAt: string | null, now: number): string | null {
  if (!lastBackupAt) {
    return "No backup has been created yet.";
  }

  const lastDate = new Date(lastBackupAt);
  if (Number.isNaN(lastDate.getTime())) {
    return null;
  }

  const diffMs = now - lastDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return null;
  }

  return `Last backup: ${diffDays} days ago (${lastDate.toLocaleString()})`;
}

function getInitialBackupMessage(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return createBackupMessage(
    localStorage.getItem("lastBackupAt"),
    getCurrentTimestamp()
  );
}

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<number>(0);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("notes");
  const [unsavedDialog, setUnsavedDialog] =
    useState<UnsavedDialogState | null>(null);
  const unsavedChoiceResolverRef = useRef<((choice: UnsavedChoice) => void) | null>(
    null
  );
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [backupMessage, setBackupMessage] = useState<string | null>(
    getInitialBackupMessage
  );
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
  const draftLines = useMemo(() => draftBody.split("\n"), [draftBody]);
  const taskLineIndexes = useMemo(
    () => new Set(getTaskLineIndexes(draftBody)),
    [draftBody]
  );

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

  const selectedNote = selectedId
    ? notes.find((note) => note.id === selectedId)
    : undefined;
  const isDraftNote = selectedId !== null && !selectedNote;

  const resetDraft = (note?: Note) => {
    if (!note) {
      setDraftTitle("");
      setDraftTags([]);
      setTagInput("");
      setDraftBody("");
      setDraftUpdatedAt(0);
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveStatus("idle");
      setLastSaveError(null);
      return;
    }
    setDraftTitle(note.title);
    setDraftTags(note.tags);
    setTagInput("");
    setDraftBody(note.body);
    setDraftUpdatedAt(note.updatedAt);
    setIsDirty(false);
    isDirtyRef.current = false;
    setSaveStatus("saved");
    setLastSaveError(null);
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

  const handleImport = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      return;
    }

    const canContinue = await confirmUnsavedTransition("import Markdown files");
    if (!canContinue) {
      input.value = "";
      return;
    }

    const imported: Note[] = [];
    try {
      for (const file of files) {
        const content = await file.text();
        const parsed = parseMarkdownWithFrontmatter(content);
        const fallbackTitle = filenameToTitle(file.name);
        const title =
          parsed.title ?? extractTitle(parsed.body ?? content, fallbackTitle);
        const note: Note = {
          id: createId(),
          title,
          body: parsed.body ?? content,
          tags: parsed.tags ?? [],
          updatedAt: parsed.updatedAt ?? getCurrentTimestamp(),
        };
        await saveNote(note);
        imported.push(note);
      }

      if (imported.length > 0) {
        setNotes((prev) =>
          [...imported, ...prev].sort((a, b) => b.updatedAt - a.updatedAt)
        );
      }
      setDbError(dbInitError);
    } catch (error) {
      if (imported.length > 0) {
        setNotes((prev) =>
          [...imported, ...prev].sort((a, b) => b.updatedAt - a.updatedAt)
        );
      }
      setDbError(getErrorMessage(error, "Failed to import Markdown files."));
    }

    input.value = "";
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
    setDraftBody(note.body);
    setDraftUpdatedAt(note.updatedAt);
    setIsDirty(true);
    isDirtyRef.current = true;
    setSaveStatus("draft");
    setLastSaveError(null);
    setMobileView("editor");
    setActiveTab("edit");
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
      setSaveStatus("saved");
      setLastSaveError(null);
      isDirtyRef.current = false;
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

  const handleSelectNote = async (note: Note) => {
    const canContinue = await confirmUnsavedTransition("open another note");
    if (!canContinue) {
      return;
    }
    setSelectedId(note.id);
    resetDraft(note);
    setMobileView("editor");
    setActiveTab("edit");
  };

  const handleShowNotes = async () => {
    const canContinue = await confirmUnsavedTransition("return to Notes");
    if (!canContinue) {
      return;
    }
    setMobileView("notes");
  };

  const statusText =
    saveStatus === "saving"
      ? "Status: Saving"
      : saveStatus === "error"
      ? "Status: Save failed"
      : isDraftNote
      ? "Status: Draft"
      : isDirty
      ? "Status: Unsaved changes"
      : selectedId
      ? "Status: Saved"
      : "Status: No note";

  const filteredNotes = notes.filter((note) => {
    const query = searchQuery.trim().toLowerCase();
    const tags = parseTags(tagFilter);
    const matchesQuery =
      query.length === 0 ||
      note.title.toLowerCase().includes(query) ||
      note.body.toLowerCase().includes(query);
    const matchesTags =
      tags.length === 0 ||
      tags.every((tag) =>
        note.tags.map((value) => value.toLowerCase()).includes(tag.toLowerCase())
      );
    return matchesQuery && matchesTags;
  });

  const handleDelete = async () => {
    if (!selectedNote) {
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedNote.title || "Untitled"}"?`
    );
    if (!confirmed) {
      return;
    }
    try {
      await deleteNote(selectedNote.id);
      setNotes((prev) => prev.filter((note) => note.id !== selectedNote.id));
      setSelectedId(null);
      resetDraft();
      setMobileView("notes");
      setDbError(dbInitError);
    } catch (error) {
      setDbError(getErrorMessage(error, "Failed to delete the note."));
    }
  };

  const downloadMarkdown = (note: Note) => {
    const title = note.title || "Untitled";
    const content = toMarkdownWithFrontmatter(note);
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const getDraftExportNote = (): Note => ({
    id: selectedId ?? createId(),
    title: draftTitle.trim() || "Untitled",
    body: draftBody,
    tags: getEffectiveTags(),
    updatedAt: draftUpdatedAt || getCurrentTimestamp(),
  });

  const handleExport = () => {
    if (!selectedNote && !isDraftNote) {
      return;
    }
    downloadMarkdown(getDraftExportNote());
  };

  const handleDownloadDraft = () => {
    downloadMarkdown(getDraftExportNote());
  };

  const handleBackupAll = () => {
    if (notes.length === 0) {
      return;
    }
    for (const note of notes) {
      downloadMarkdown(note);
    }
    const nowIso = new Date().toISOString();
    localStorage.setItem("lastBackupAt", nowIso);
    setBackupMessage(null);
  };

  return (
    <div className={`app mobile-${mobileView}`}>
      <aside className="sidebar">
        <div className="sidebar-section">
          <button
            className="new-note-button"
            type="button"
            onClick={handleNewNote}
          >
            + New Note
          </button>
        </div>
        <div className="sidebar-section">
          <button
            className="backup-button"
            type="button"
            onClick={handleBackupAll}
            disabled={notes.length === 0}
          >
            Backup All Notes
          </button>
        </div>
        <div className="sidebar-section">
          <label className="label" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Search title or body"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <div className="sidebar-section">
          <label className="label" htmlFor="tag-filter">
            Tag filter
          </label>
          <input
            id="tag-filter"
            className="input"
            placeholder="tag1, tag2"
            type="text"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
          />
        </div>
        <div className="sidebar-section">
          <div className="section-title">Import</div>
          <label className="import-button" htmlFor="import-md">
            Import Markdown
          </label>
          <input
            id="import-md"
            className="file-input"
            type="file"
            accept=".md,text/markdown"
            multiple
            onChange={handleImport}
          />
        </div>
        <div className="sidebar-section">
          <div className="section-title">Notes</div>
          <ul className="note-list">
            {filteredNotes.length === 0 ? (
              <li className="note-item empty">
                {notes.length === 0 ? "No notes yet." : "No matches."}
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
                  <div className="note-title">{note.title || "Untitled"}</div>
                  <div className="note-meta">{formatDate(note.updatedAt)}</div>
                </li>
              ))
            )}
          </ul>
        </div>
      </aside>
      <main className="editor">
        {backupMessage ? (
          <div className="backup-banner">{backupMessage}</div>
        ) : null}
        <div className="editor-header">
          <div className="editor-title-row">
            <button
              className="mobile-back-button secondary-button"
              type="button"
              onClick={handleShowNotes}
            >
              Notes
            </button>
            <h1 className="app-title">Markdown Knowledge Board</h1>
          </div>
          <div className="editor-actions">
            <div className="save-status">{statusText}</div>
            <button
              className="primary-button"
              type="button"
              onClick={handleSave}
              disabled={saveStatus === "saving"}
            >
              {saveStatus === "saving" ? "Saving" : "Save"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={handleExport}
              disabled={!selectedNote && !isDraftNote}
            >
              Export
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={handleDelete}
              disabled={!selectedNote}
            >
              Delete
            </button>
          </div>
        </div>
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
            onClick={() => setActiveTab("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={`tab-button${activeTab === "preview" ? " active" : ""}`}
            onClick={() => setActiveTab("preview")}
          >
            Preview
          </button>
        </div>
        <div className="editor-section">
          <label className="label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            className="input"
            placeholder="Note title"
            type="text"
            value={draftTitle}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              markDirty();
            }}
          />
        </div>
        <div className="editor-section">
          <label className="label" htmlFor="tags-input">
            Tags
          </label>
          <div className="tag-input">
            {draftTags.length === 0 ? (
              <span className="tag-placeholder">No tags yet.</span>
            ) : null}
            {draftTags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
                <button
                  className="tag-remove"
                  type="button"
                  onClick={() => removeTag(tag)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              id="tags-input"
              className="tag-text-input"
              placeholder="Type tag and press Enter"
              type="text"
              value={tagInput}
              onChange={(event) => {
                setTagInput(event.target.value);
                markDirty();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagInput);
                  setTagInput("");
                }
              }}
            />
          </div>
          {candidateTags.length > 0 ? (
            <div className="tag-candidates">
              {candidateTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="tag-candidate"
                  onClick={() => addTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {activeTab === "edit" ? (
          <div className="editor-section editor-body">
            <div className="md-toolbar" role="toolbar" aria-label="Markdown tools">
              <button
                type="button"
                className="md-button"
                title="Bold"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleWrap("**", "**", "bold")}
              >
                Bold
              </button>
              <button
                type="button"
                className="md-button"
                title="Italic"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleWrap("*", "*", "italic")}
              >
                Italic
              </button>
              <button
                type="button"
                className="md-button"
                title="Strike"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleWrap("~~", "~~", "strike")}
              >
                Strike
              </button>
              <button
                type="button"
                className="md-button"
                title="Code"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleWrap("`", "`", "code")}
              >
                Code
              </button>
              <button
                type="button"
                className="md-button"
                title="H1"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleToggleLine("# ")}
              >
                H1
              </button>
              <button
                type="button"
                className="md-button"
                title="H2"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleToggleLine("## ")}
              >
                H2
              </button>
              <button
                type="button"
                className="md-button"
                title="Bullet"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleToggleLine("- ")}
              >
                Bullet
              </button>
              <button
                type="button"
                className="md-button"
                title="Task"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleToggleLine("- [ ] ")}
              >
                Task
              </button>
              <button
                type="button"
                className="md-button"
                title="Quote"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleToggleLine("> ")}
              >
                Quote
              </button>
              <button
                type="button"
                className="md-button"
                title="Link"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleInsertLink}
              >
                Link
              </button>
            </div>
            <label className="label" htmlFor="body">
              Body
            </label>
            <textarea
              id="body"
              className="textarea textarea-fill"
              placeholder="Write markdown here..."
              rows={16}
              ref={bodyRef}
              value={draftBody}
              onChange={(event) => {
                setDraftBody(event.target.value);
                markDirty();
              }}
            />
          </div>
        ) : (
          <div className="preview-panel editor-body">
            <div className="preview-label">Preview</div>
            {draftBody.trim().length === 0 ? (
              <div className="preview-empty">Nothing to preview.</div>
            ) : (
              <div className="mdPreview mdPreview-scroll">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    input: () => null,
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
                          <span
                            className="taskCheckbox"
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
                          </span>
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
        )}
      </main>
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
    </div>
  );
}

export default App;










