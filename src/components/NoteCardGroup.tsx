import { useRef } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { MoreVertical, Pin } from "lucide-react";
import type { Note } from "../lib/types";
import type { NoteGroup } from "../lib/noteOrder";

const sensors = [
  PointerSensor.configure({ activationConstraints: [
    new PointerActivationConstraints.Delay({ value: 300, tolerance: 7 }),
  ] }),
  KeyboardSensor.configure({ keyboardCodes: { ...KeyboardSensor.defaults.keyboardCodes, start: ["Space"] } }),
];

type CardProps = {
  selectedId: string | null;
  menuId: string | null;
  disabled: boolean;
  onSelect: (note: Note) => void;
  onMenu: (note: Note, button: HTMLButtonElement) => void;
  formatDate: (timestamp: number) => string;
};

type NoteCardProps = CardProps & { note: Note; index: number; pinned: boolean };

function SortableCard(props: NoteCardProps) {
  const { ref, handleRef, isDragSource } = useSortable({ id: props.note.id, index: props.index });
  return <NoteCard {...props} cardRef={ref} buttonRef={handleRef} lifted={isDragSource} />;
}

function NoteCard({ note, pinned, selectedId, menuId, onSelect, onMenu, formatDate, cardRef, buttonRef, lifted }:
  NoteCardProps & { cardRef?: (element: Element | null) => void; buttonRef?: (element: Element | null) => void; lifted?: boolean }) {
  return (
    <li
      ref={cardRef}
      data-lifted={lifted || undefined}
      className={`note-item${
        note.id === selectedId ? " active" : ""
      }${pinned ? " pinned" : ""}${
        note.id === selectedId || pinned
          ? " has-card-action"
          : ""
      }`}
      data-pinned={pinned || undefined}
      data-menu-open={menuId === note.id || undefined}
    >
      <button
        ref={buttonRef}
        className="note-card-select"
        type="button"
        data-note-id={note.id}
        aria-label={`Open note: ${note.title || "Untitled"}`}
        aria-current={note.id === selectedId ? "true" : undefined}
        onClick={event => { if (!event.defaultPrevented) onSelect(note); }}
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
      {note.id === selectedId || pinned ? (
        <button
          className={`note-card-menu-trigger${
            pinned ? " is-pinned" : ""
          }`}
          type="button"
          aria-label={
            pinned
              ? `Pinned note actions: ${note.title || "Untitled"}`
              : "Selected note actions"
          }
          title={
            pinned ? "Pinned note actions" : "More actions"
          }
          aria-haspopup="menu"
          aria-expanded={menuId === note.id}
          aria-controls={
            menuId === note.id
              ? "note-card-actions-menu"
              : undefined
          }
          onClick={event => onMenu(note, event.currentTarget)}
        >
          {pinned ? (
            <Pin aria-hidden="true" />
          ) : (
            <MoreVertical aria-hidden="true" />
          )}
        </button>
      ) : null}
    </li>
  );
}

export function NoteCardGroup({ group, notes, onMove, ...cardProps }: CardProps & {
  group: NoteGroup;
  notes: Note[];
  onMove: (expected: string[], id: string, target: string) => void;
}) {
  const Card = cardProps.disabled || notes.length < 2 ? NoteCard : SortableCard;
  const list = useRef<HTMLUListElement>(null);
  const initialIds = useRef<string[]>([]);
  return (
    <DragDropProvider sensors={sensors}
      onDragStart={() => { initialIds.current = notes.map(note => note.id); }}
      onDragEnd={({ operation, canceled, nativeEvent }) => {
        const source = operation.source;
        if (cardProps.disabled || canceled || !isSortable(source) || source.index === source.initialIndex) return;
        if (nativeEvent instanceof PointerEvent) {
          const bounds = list.current?.getBoundingClientRect();
          const viewport = list.current?.parentElement?.getBoundingClientRect();
          if (!bounds || !viewport || nativeEvent.clientX < bounds.left || nativeEvent.clientX > bounds.right ||
              nativeEvent.clientY < Math.max(bounds.top, viewport.top) ||
              nativeEvent.clientY > Math.min(bounds.bottom, viewport.bottom)) return;
        }
        const ids = initialIds.current;
        if (ids[source.initialIndex] === source.id && ids[source.index]) {
          onMove(ids, ids[source.initialIndex], ids[source.index]);
        }
      }}>
      <ul ref={list} className="note-group" aria-label={group === "pinned" ? "Pinned notes" : "Other notes"}>
        {notes.map((note, index) => <Card key={note.id} {...cardProps} note={note}
          index={index} pinned={group === "pinned"} />)}
      </ul>
    </DragDropProvider>
  );
}
