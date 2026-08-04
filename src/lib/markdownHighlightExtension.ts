import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";

const EQUALS_SIGN = 61;
const BACKSLASH = 92;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const highlightDelimiter: DelimiterType = {
  resolve: "Highlight",
  mark: "HighlightMark",
};

function isWhitespace(character: number) {
  return character < 0 || /\s/u.test(String.fromCharCode(character));
}

function isLineBreak(character: number) {
  return character === LINE_FEED || character === CARRIAGE_RETURN;
}

function hasClosingDelimiter(
  context: { char(position: number): number; end: number },
  from: number,
) {
  for (let position = from; position < context.end - 1; position += 1) {
    const character = context.char(position);
    if (isLineBreak(character)) return false;
    if (character === BACKSLASH) {
      position += 1;
      continue;
    }
    if (
      character === EQUALS_SIGN &&
      context.char(position + 1) === EQUALS_SIGN &&
      context.char(position - 1) !== EQUALS_SIGN &&
      context.char(position + 2) !== EQUALS_SIGN &&
      !isWhitespace(context.char(position - 1))
    ) {
      return true;
    }
  }
  return false;
}

function hasOpeningDelimiter(
  context: { char(position: number): number; offset: number },
  before: number,
) {
  for (
    let position = before - 1;
    position >= context.offset + 1;
    position -= 1
  ) {
    const character = context.char(position);
    if (isLineBreak(character)) return false;
    if (
      context.char(position - 1) === EQUALS_SIGN &&
      character === EQUALS_SIGN &&
      context.char(position - 2) !== EQUALS_SIGN &&
      context.char(position + 1) !== EQUALS_SIGN &&
      context.char(position - 2) !== BACKSLASH &&
      !isWhitespace(context.char(position + 1))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Adds the app's existing single-line ==highlight== syntax to Lezer Markdown.
 * The Preview parser uses the same single-line constraint.
 */
export const markdownHighlightExtension: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [
    {
      name: "Highlight",
      before: "Emphasis",
      parse(context, next, position) {
        if (
          next !== EQUALS_SIGN ||
          context.char(position + 1) !== EQUALS_SIGN ||
          context.char(position - 1) === EQUALS_SIGN ||
          context.char(position + 2) === EQUALS_SIGN
        ) {
          return -1;
        }

        const delimiterTo = position + 2;
        const canOpen =
          !isWhitespace(context.char(delimiterTo)) &&
          hasClosingDelimiter(context, delimiterTo);
        const canClose =
          !isWhitespace(context.char(position - 1)) &&
          hasOpeningDelimiter(context, position);
        if (!canOpen && !canClose) {
          return -1;
        }

        return context.addDelimiter(
          highlightDelimiter,
          position,
          delimiterTo,
          canOpen,
          canClose,
        );
      },
    },
  ],
};
