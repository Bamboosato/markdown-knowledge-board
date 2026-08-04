import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  clampEditorOffset,
  findMinimalEditorChange,
} from "../lib/markdownEditorSync";
import { markdownHighlightExtension } from "../lib/markdownHighlightExtension";
import { markdownMarkerDecorations } from "../lib/markdownMarkerDecorations";

export type EditorSelectionSnapshot = {
  noteId: string | null;
  bodyValue: string;
  start: number;
  end: number;
  scrollTop: number;
  scrollLeft: number;
};

export type MarkdownBodyEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  scrollLeft: number;
};

export type MarkdownBodyEditorHandle = {
  applyEdit(edit: MarkdownBodyEdit): void;
  focus(): void;
  getRootElement(): HTMLDivElement | null;
  getSelectionSnapshot(): EditorSelectionSnapshot | null;
  getValue(): string;
  replaceValue(
    value: string,
    options?: { addToHistory?: boolean; focus?: boolean },
  ): void;
  requestMeasure(): void;
  setScrollPosition(position: { top: number; left?: number }): void;
};

type MarkdownBodyEditorProps = {
  labelledBy: string;
  noteId: string | null;
  onChange(value: string): void;
  onSelectionChange?(snapshot: EditorSelectionSnapshot): void;
  placeholder: string;
  resetKey: number;
  value: string;
};

type TextareaCompatibleContent = HTMLElement & {
  selectionEnd?: number;
  selectionStart?: number;
  setSelectionRange?: (start: number, end: number) => void;
  value?: string;
};

function installAutomationCompatibility(view: EditorView) {
  const content = view.contentDOM as TextareaCompatibleContent;

  Object.defineProperties(content, {
    value: {
      configurable: true,
      get: () => view.state.doc.toString(),
    },
    selectionStart: {
      configurable: true,
      get: () => view.state.selection.main.from,
    },
    selectionEnd: {
      configurable: true,
      get: () => view.state.selection.main.to,
    },
    scrollTop: {
      configurable: true,
      get: () => view.scrollDOM.scrollTop,
      set: (value: number) => {
        view.scrollDOM.scrollTop = value;
      },
    },
    scrollLeft: {
      configurable: true,
      get: () => view.scrollDOM.scrollLeft,
      set: (value: number) => {
        view.scrollDOM.scrollLeft = value;
      },
    },
  });

  content.setSelectionRange = (start, end) => {
    const length = view.state.doc.length;
    view.dispatch({
      selection: {
        anchor: clampEditorOffset(start, length),
        head: clampEditorOffset(end, length),
      },
    });
  };
}

function restoreScrollPosition(
  view: EditorView,
  position: { top: number; left?: number },
) {
  const apply = () => {
    view.scrollDOM.scrollTop = position.top;
    if (position.left !== undefined) {
      view.scrollDOM.scrollLeft = position.left;
    }
  };

  apply();
  requestAnimationFrame(() => {
    if (!view.scrollDOM.isConnected) return;
    apply();
  });
}

export const MarkdownBodyEditor = forwardRef<
  MarkdownBodyEditorHandle,
  MarkdownBodyEditorProps
>(function MarkdownBodyEditor(
  {
    labelledBy,
    noteId,
    onChange,
    onSelectionChange,
    placeholder,
    resetKey,
    value,
  },
  forwardedRef,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);
  const pendingExternalValueRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  const buildStateRef = useRef<(document: string) => EditorState>(() =>
    EditorState.create(),
  );
  const noteIdRef = useRef(noteId);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const lastResetKeyRef = useRef(resetKey);

  noteIdRef.current = noteId;
  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  valueRef.current = value;

  const notifySelectionChange = useCallback((view: EditorView) => {
    const selection = view.state.selection.main;
    onSelectionChangeRef.current?.({
      noteId: noteIdRef.current,
      bodyValue: view.state.doc.toString(),
      start: selection.from,
      end: selection.to,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    });
  }, []);

  buildStateRef.current = (document) =>
    EditorState.create({
      doc: document,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({
          addKeymap: false,
          extensions: [...GFM, markdownHighlightExtension],
        }),
        markdownMarkerDecorations,
        EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            id: "body",
            "aria-labelledby": labelledBy,
          autocapitalize: "sentences",
          spellcheck: "true",
        }),
        EditorView.editorAttributes.of({
          class: "markdown-body-editor__view",
        }),
        EditorView.domEventHandlers({
          compositionend: (_event, view) => {
            requestAnimationFrame(() => {
              const pendingValue = pendingExternalValueRef.current;
              pendingExternalValueRef.current = null;
              if (
                pendingValue === null ||
                valueRef.current !== pendingValue ||
                view.state.doc.toString() === pendingValue
              ) {
                return;
              }

              const change = findMinimalEditorChange(
                view.state.doc.toString(),
                pendingValue,
              );
              if (change) {
                view.dispatch({
                  changes: change,
                  annotations: Transaction.addToHistory.of(false),
                });
              }
            });
            return false;
          },
        }),
        placeholderExtension(placeholder),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }

          if (update.docChanged || update.selectionSet) {
            notifySelectionChange(update.view);
          }
        }),
      ],
    });

  const getSelectionSnapshot = () => {
    const view = viewRef.current;
    if (!view) return null;

    return {
      noteId: noteIdRef.current,
      bodyValue: view.state.doc.toString(),
      start: view.state.selection.main.from,
      end: view.state.selection.main.to,
      scrollTop: view.scrollDOM.scrollTop,
      scrollLeft: view.scrollDOM.scrollLeft,
    };
  };

  const dispatchValue = (
    nextValue: string,
    selection: { start: number; end: number },
    options: {
      addToHistory: boolean;
      focus: boolean;
      scrollLeft?: number;
      scrollTop?: number;
    },
  ) => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    const change = findMinimalEditorChange(currentValue, nextValue);
    const length = nextValue.length;
    const transaction = {
      ...(change ? { changes: change } : {}),
      selection: {
        anchor: clampEditorOffset(selection.start, length),
        head: clampEditorOffset(selection.end, length),
      },
      annotations: Transaction.addToHistory.of(options.addToHistory),
    };

    view.dispatch(transaction);

    if (options.focus) view.focus();
    if (options.scrollTop !== undefined) {
      restoreScrollPosition(view, {
        top: options.scrollTop,
        left: options.scrollLeft,
      });
    }
  };

  useImperativeHandle(
    forwardedRef,
    () => ({
      applyEdit(edit) {
        dispatchValue(
          edit.value,
          { start: edit.selectionStart, end: edit.selectionEnd },
          {
            addToHistory: true,
            focus: true,
            scrollTop: edit.scrollTop,
            scrollLeft: edit.scrollLeft,
          },
        );
      },
      focus() {
        viewRef.current?.focus();
      },
      getRootElement() {
        return hostRef.current;
      },
      getSelectionSnapshot,
      getValue() {
        return viewRef.current?.state.doc.toString() ?? value;
      },
      replaceValue(nextValue, options) {
        const selection = viewRef.current?.state.selection.main;
        dispatchValue(
          nextValue,
          {
            start: selection?.from ?? 0,
            end: selection?.to ?? 0,
          },
          {
            addToHistory: options?.addToHistory ?? false,
            focus: options?.focus ?? false,
          },
        );
      },
      requestMeasure() {
        viewRef.current?.requestMeasure();
      },
      setScrollPosition(position) {
        const view = viewRef.current;
        if (!view) return;
        restoreScrollPosition(view, position);
      },
    }),
    [value],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      state: buildStateRef.current(initialValueRef.current),
      parent: host,
    });
    viewRef.current = view;
    installAutomationCompatibility(view);
    notifySelectionChange(view);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [notifySelectionChange]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (lastResetKeyRef.current !== resetKey) {
      lastResetKeyRef.current = resetKey;
      pendingExternalValueRef.current = null;
      view.setState(buildStateRef.current(value));
      installAutomationCompatibility(view);
      notifySelectionChange(view);
      return;
    }

    if (view.state.doc.toString() !== value) {
      if (view.composing) {
        pendingExternalValueRef.current = value;
        return;
      }

      pendingExternalValueRef.current = null;
      const change = findMinimalEditorChange(view.state.doc.toString(), value);
      if (change) {
        view.dispatch({
          changes: change,
          annotations: Transaction.addToHistory.of(false),
        });
      }
    }
  }, [notifySelectionChange, resetKey, value]);

  return (
    <div
      className="markdown-body-editor textarea textarea-fill"
      data-testid="body-editor"
      ref={hostRef}
    />
  );
});
