import { useEffect, useRef } from "react";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

type ImportChoiceDialogProps = {
  fileNames: string[];
  noteTitle: string;
  onAdd: () => void;
  onReplace: () => void;
  onCancel: () => void;
};

export function ImportChoiceDialog({
  fileNames,
  noteTitle,
  onAdd,
  onReplace,
  onCancel,
}: ImportChoiceDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const isMultiple = fileNames.length !== 1;
  const titleId = "import-choice-title";
  const descriptionId = "import-choice-description";
  const metadataId = "import-choice-metadata";

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)"
      ) ?? []
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
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
      onCancel();
    }
  };

  const blockAdditionalFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={handleBackdropMouseDown}
      onDragOver={blockAdditionalFileDrop}
      onDrop={blockAdditionalFileDrop}
    >
      <div
        ref={dialogRef}
        className="import-choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${metadataId}`}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>
          {isMultiple ? "Import Markdown Files" : "Import Markdown File"}
        </h2>
        <p id={descriptionId}>
          {isMultiple
            ? "Choose how to import these files."
            : `Choose how to import "${fileNames[0]}".`}
        </p>
        <p className="import-choice-target">
          <strong>Current note:</strong> "{noteTitle}"
        </p>
        <p id={metadataId} className="import-choice-metadata">
          The current note&apos;s title, tags, Marp settings, custom metadata,
          and pinned state will be preserved.
        </p>
        <div className="dialog-actions import-choice-actions">
          <button className="primary-button" type="button" onClick={onAdd}>
            {isMultiple ? "Add as New Notes" : "Add as New Note"}
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={isMultiple}
            onClick={onReplace}
          >
            Replace Current Note Body
          </button>
          {isMultiple ? (
            <span className="import-choice-disabled-note">
              Available when one file is dropped.
            </span>
          ) : null}
          <button
            ref={cancelButtonRef}
            className="secondary-button"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
