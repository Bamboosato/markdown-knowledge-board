import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";

export type MarkdownMarkerRange = {
  from: number;
  to: number;
  nodeName: string;
};

const directMarkerNodes = new Set([
  "CodeMark",
  "EmphasisMark",
  "HeaderMark",
  "HighlightMark",
  "LinkMark",
  "ListMark",
  "QuoteMark",
  "StrikethroughMark",
  "TaskMarker",
]);

function splitNonWhitespace(
  state: EditorState,
  node: SyntaxNodeRef,
): MarkdownMarkerRange[] {
  const text = state.sliceDoc(node.from, node.to);
  const ranges: MarkdownMarkerRange[] = [];

  for (const match of text.matchAll(/\S+/gu)) {
    const offset = match.index;
    ranges.push({
      from: node.from + offset,
      to: node.from + offset + match[0].length,
      nodeName: node.name,
    });
  }

  return ranges;
}

function rangesForNode(
  state: EditorState,
  node: SyntaxNodeRef,
): MarkdownMarkerRange[] {
  if (directMarkerNodes.has(node.name)) {
    return [{ from: node.from, to: node.to, nodeName: node.name }];
  }

  if (node.name === "TableDelimiter" || node.name === "HorizontalRule") {
    return splitNonWhitespace(state, node);
  }

  if (node.name === "LinkLabel") {
    const text = state.sliceDoc(node.from, node.to);
    const ranges: MarkdownMarkerRange[] = [];
    if (text.startsWith("[")) {
      ranges.push({ from: node.from, to: node.from + 1, nodeName: node.name });
    }
    if (text.endsWith("]")) {
      ranges.push({ from: node.to - 1, to: node.to, nodeName: node.name });
    }
    return ranges;
  }

  if (node.name === "URL") {
    const text = state.sliceDoc(node.from, node.to);
    return text.startsWith("<") && text.endsWith(">")
      ? [
          { from: node.from, to: node.from + 1, nodeName: node.name },
          { from: node.to - 1, to: node.to, nodeName: node.name },
        ]
      : [];
  }

  if (node.name === "Escape" || node.name === "HardBreak") {
    return state.sliceDoc(node.from, node.from + 1) === "\\"
      ? [{ from: node.from, to: node.from + 1, nodeName: node.name }]
      : [];
  }

  return [];
}

export function collectMarkdownMarkerRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
) {
  const ranges: MarkdownMarkerRange[] = [];

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      ranges.push(...rangesForNode(state, node));
    },
  });

  return ranges;
}

const markerDecoration = Decoration.mark({ class: "cm-md-marker" });

function buildMarkerDecorations(view: EditorView) {
  const ranges = view.visibleRanges.flatMap(({ from, to }) =>
    collectMarkdownMarkerRanges(view.state, from, to),
  );

  return Decoration.set(
    ranges.map(({ from, to }) => markerDecoration.range(from, to)),
    true,
  );
}

class MarkdownMarkerView {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildMarkerDecorations(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      this.decorations = buildMarkerDecorations(update.view);
    }
  }
}

export const markdownMarkerDecorations = ViewPlugin.fromClass(
  MarkdownMarkerView,
  {
    decorations: (plugin) => plugin.decorations,
  },
);
