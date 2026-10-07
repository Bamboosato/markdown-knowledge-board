import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  RESERVED_FRONTMATTER_KEYS,
  UNSAFE_FRONTMATTER_KEYS,
  assertFrontmatterExpansion,
  parseFrontmatterValueText,
  serializeFrontmatterValue,
} from "../lib/frontmatter";
import type { FrontmatterEntry } from "../lib/frontmatter";
import type { CustomMetadataEntry, FrontmatterValue } from "../lib/types";

type EditableRow = {
  rowId: string;
  keyText: string;
  valueText: string;
};

type RowValidation = {
  errors: string[];
  parsedValue?: FrontmatterValue;
};

type MetadataDialogProps = {
  managedEntries: FrontmatterEntry[];
  customMetadata: CustomMetadataEntry[];
  onApply: (entries: CustomMetadataEntry[]) => void;
  onClose: () => void;
};

const MAX_CUSTOM_FIELDS = 100;
const MAX_KEY_LENGTH = 100;
const MAX_VALUE_LENGTH = 10000;

function createRow(entry?: CustomMetadataEntry): EditableRow {
  return {
    rowId: crypto.randomUUID(),
    keyText: entry?.key ?? "",
    valueText: entry ? serializeFrontmatterValue(entry.value) : "",
  };
}

function rowsSignature(rows: EditableRow[]): string {
  return JSON.stringify(
    rows.map(({ keyText, valueText }) => ({ keyText, valueText }))
  );
}

export function MetadataDialog({
  managedEntries,
  customMetadata,
  onApply,
  onClose,
}: MetadataDialogProps) {
  const [initialRows] = useState<EditableRow[]>(() =>
    customMetadata.map((entry) => createRow(entry))
  );
  const [rows, setRows] = useState<EditableRow[]>(() => initialRows);
  const [isDiscardConfirmationOpen, setIsDiscardConfirmationOpen] =
    useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  const normalizedKeys = useMemo(
    () => rows.map((row) => row.keyText.trim()),
    [rows]
  );
  const keyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const key of normalizedKeys) {
      if (key) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [normalizedKeys]);

  const validations = useMemo<RowValidation[]>(
    () =>
      rows.map((row, index) => {
        const errors: string[] = [];
        const key = normalizedKeys[index];
        if (!key) {
          errors.push("Key is required.");
        } else {
          if (key.length > MAX_KEY_LENGTH) {
            errors.push(`Key must be ${MAX_KEY_LENGTH} characters or fewer.`);
          }
          if (RESERVED_FRONTMATTER_KEYS.has(key)) {
            errors.push(`${key} is managed by the application.`);
          }
          if (UNSAFE_FRONTMATTER_KEYS.has(key)) {
            errors.push(`${key} is not allowed.`);
          }
          if ((keyCounts.get(key) ?? 0) > 1) {
            errors.push("Key must be unique.");
          }
        }

        if (row.valueText.length > MAX_VALUE_LENGTH) {
          errors.push(`Value must be ${MAX_VALUE_LENGTH} characters or fewer.`);
          return { errors };
        }
        try {
          return {
            errors,
            parsedValue: parseFrontmatterValueText(row.valueText),
          };
        } catch (error) {
          errors.push(
            error instanceof Error ? error.message : "Value is not valid YAML."
          );
          return { errors };
        }
      }),
    [keyCounts, normalizedKeys, rows]
  );

  const collectionError = useMemo(() => {
    if (validations.some((validation) => validation.errors.length > 0)) {
      return "";
    }
    try {
      // Check the same collection representation used by copying and export.
      assertFrontmatterExpansion(
        rows.map((_, index) => ({
          key: normalizedKeys[index],
          value: validations[index].parsedValue ?? "",
        }))
      );
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : "Metadata is too large.";
    }
  }, [normalizedKeys, rows, validations]);
  const hasErrors =
    Boolean(collectionError) ||
    validations.some((validation) => validation.errors.length > 0);
  const isDirty = rowsSignature(rows) !== rowsSignature(initialRows);

  useEffect(() => {
    const firstKey = dialogRef.current?.querySelector<HTMLInputElement>(
      ".metadata-custom-key"
    );
    requestAnimationFrame(() => (firstKey ?? addButtonRef.current ?? dialogRef.current)?.focus());
  }, []);

  const requestClose = () => {
    if (isDirty) {
      setIsDiscardConfirmationOpen(true);
      return;
    }
    onClose();
  };

  const apply = () => {
    if (hasErrors) {
      const firstErrorIndex = validations.findIndex(
        (validation) => validation.errors.length > 0
      );
      const fields = dialogRef.current?.querySelectorAll<HTMLInputElement>(
        ".metadata-custom-key, .metadata-custom-value"
      );
      fields?.[firstErrorIndex * 2]?.focus();
      return;
    }
    onApply(
      rows.map((_, index) => ({
        key: normalizedKeys[index],
        value: validations[index].parsedValue ?? "",
      }))
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isDiscardConfirmationOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsDiscardConfirmationOpen(false);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      apply();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      requestClose();
    }
  };

  const updateRow = (
    rowId: string,
    field: "keyText" | "valueText",
    value: string
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.rowId === rowId ? { ...row, [field]: value } : row
      )
    );
  };

  const deleteRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.rowId !== rowId));
    requestAnimationFrame(() => addButtonRef.current?.focus());
  };

  const addRow = () => {
    if (rows.length >= MAX_CUSTOM_FIELDS) {
      return;
    }
    const row = createRow();
    setRows((current) => [...current, row]);
    requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLInputElement>(`[data-row-id="${row.rowId}"]`)
        ?.focus();
    });
  };

  return (
    <div className="modal-backdrop metadata-backdrop" onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className={`metadata-dialog${
          isDiscardConfirmationOpen ? " metadata-dialog-confirmation" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-dialog-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {isDiscardConfirmationOpen ? (
          <div className="metadata-discard-confirmation" role="alertdialog" aria-labelledby="metadata-discard-title">
            <h2 id="metadata-discard-title">Discard metadata changes?</h2>
            <p>Your unapplied metadata changes will be lost.</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsDiscardConfirmationOpen(false)}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={onClose}
              >
                Discard
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="metadata-dialog-header">
              <h2 id="metadata-dialog-title">Metadata</h2>
              <p>Fields are shown in Markdown export order.</p>
            </div>
            <div className="metadata-dialog-body">
              <section
                className="metadata-managed-section"
                aria-labelledby="metadata-managed-title"
              >
                <div className="metadata-section-heading">
                  <h3 id="metadata-managed-title">Managed fields</h3>
                  <span className="metadata-readonly-badge">Read-only</span>
                </div>
                <dl className="metadata-managed-list">
                  {managedEntries.map((entry) => (
                    <div key={entry.key} className="metadata-managed-row">
                      <dt>{entry.key}</dt>
                      <dd>
                        <code>{serializeFrontmatterValue(entry.value)}</code>
                        {!entry.includedInExport ? (
                          <span className="metadata-export-note">Not exported</span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="metadata-custom-section" aria-labelledby="metadata-custom-title">
                <div className="metadata-section-heading">
                  <h3 id="metadata-custom-title">Custom metadata</h3>
                  <span className="metadata-field-count">{rows.length} fields</span>
                </div>
                {rows.length === 0 ? (
                  <p className="metadata-empty">No custom fields.</p>
                ) : (
                  <div className="metadata-custom-list">
                    {rows.map((row, index) => {
                      const validation = validations[index];
                      const errorId = `metadata-row-error-${row.rowId}`;
                      return (
                        <div key={row.rowId} className="metadata-custom-row">
                          <label>
                            <span>Key</span>
                            <input
                              className="input metadata-custom-key"
                              data-row-id={row.rowId}
                              value={row.keyText}
                              maxLength={MAX_KEY_LENGTH + 1}
                              aria-describedby={validation.errors.length ? errorId : undefined}
                              aria-invalid={validation.errors.length > 0}
                              onChange={(event) =>
                                updateRow(row.rowId, "keyText", event.target.value)
                              }
                            />
                          </label>
                          <label>
                            <span>Value</span>
                            <input
                              className="input metadata-custom-value"
                              value={row.valueText}
                              maxLength={MAX_VALUE_LENGTH + 1}
                              aria-describedby={validation.errors.length ? errorId : undefined}
                              aria-invalid={validation.errors.length > 0}
                              onChange={(event) =>
                                updateRow(row.rowId, "valueText", event.target.value)
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="secondary-button icon-action-button tooltip-button metadata-delete-button"
                            aria-label={`Delete custom field ${row.keyText.trim() || index + 1}`}
                            data-tooltip="Delete field"
                            onClick={() => deleteRow(row.rowId)}
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                          {validation.errors.length ? (
                            <div id={errorId} className="metadata-row-error" role="status">
                              {validation.errors.join(" ")}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                <button
                  ref={addButtonRef}
                  type="button"
                  className="secondary-button metadata-add-button"
                  onClick={addRow}
                  disabled={rows.length >= MAX_CUSTOM_FIELDS}
                >
                  <Plus aria-hidden="true" />
                  Add custom field
                </button>
                {collectionError ? (
                  <div className="metadata-row-error" role="status">
                    {collectionError}
                  </div>
                ) : null}
              </section>
            </div>
            <div className="metadata-dialog-footer">
              <span className="metadata-shortcut-hint">Ctrl/⌘ + Enter to apply</span>
              <div className="dialog-actions">
                <button type="button" className="secondary-button" onClick={requestClose}>
                  Cancel
                </button>
                <button type="button" className="primary-button" onClick={apply} disabled={hasErrors}>
                  Apply
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
