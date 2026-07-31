export type EditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export type ParsedTask = {
  line: number;
  checked: boolean;
  text: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function wrapSelection(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string
): EditResult {
  const safeStart = clamp(start, 0, value.length);
  const safeEnd = clamp(end, 0, value.length);
  const hasSelection = safeEnd > safeStart;
  const selected = value.slice(safeStart, safeEnd);

  if (hasSelection) {
    const before = value.slice(safeStart - prefix.length, safeStart);
    const after = value.slice(safeEnd, safeEnd + suffix.length);
    const isWrapped = before === prefix && after === suffix;

    if (isWrapped) {
      const newValue =
        value.slice(0, safeStart - prefix.length) +
        selected +
        value.slice(safeEnd + suffix.length);
      const newStart = safeStart - prefix.length;
      const newEnd = safeEnd - prefix.length;
      return { value: newValue, selectionStart: newStart, selectionEnd: newEnd };
    }

    const newValue =
      value.slice(0, safeStart) +
      prefix +
      selected +
      suffix +
      value.slice(safeEnd);
    const newStart = safeStart + prefix.length;
    const newEnd = safeEnd + prefix.length;
    return { value: newValue, selectionStart: newStart, selectionEnd: newEnd };
  }

  const insertText = `${prefix}${placeholder}${suffix}`;
  const newValue =
    value.slice(0, safeStart) + insertText + value.slice(safeEnd);
  const cursorStart = safeStart + prefix.length;
  const cursorEnd = cursorStart + placeholder.length;
  return {
    value: newValue,
    selectionStart: cursorStart,
    selectionEnd: cursorEnd,
  };
}

export function toggleLinePrefix(
  value: string,
  cursorPos: number,
  prefix: string
): EditResult {
  const safePos = clamp(cursorPos, 0, value.length);
  const lineStart = value.lastIndexOf("\n", safePos - 1) + 1;
  const lineEnd = value.indexOf("\n", safePos);
  const end = lineEnd === -1 ? value.length : lineEnd;
  const line = value.slice(lineStart, end);

  if (line.startsWith(prefix)) {
    const newLine = line.slice(prefix.length);
    const newValue =
      value.slice(0, lineStart) + newLine + value.slice(end);
    const newPos = clamp(safePos - prefix.length, lineStart, lineStart + newLine.length);
    return { value: newValue, selectionStart: newPos, selectionEnd: newPos };
  }

  const newValue =
    value.slice(0, lineStart) + prefix + line + value.slice(end);
  const newPos = safePos + prefix.length;
  return { value: newValue, selectionStart: newPos, selectionEnd: newPos };
}

export function toggleSelectedLinePrefixes(
  value: string,
  start: number,
  end: number,
  prefix: string
): EditResult {
  const safeStart = clamp(Math.min(start, end), 0, value.length);
  const safeEnd = clamp(Math.max(start, end), 0, value.length);
  if (safeStart === safeEnd) {
    return toggleLinePrefix(value, safeStart, prefix);
  }

  const lineStart = value.lastIndexOf("\n", safeStart - 1) + 1;
  const endProbe = value[safeEnd - 1] === "\n" ? safeEnd - 1 : safeEnd;
  const nextLineBreak = value.indexOf("\n", endProbe);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const selectedLines = value.slice(lineStart, lineEnd).split("\n");
  const parsedLines = selectedLines.map((line) => {
    const indentation = line.match(/^[\t ]*/)?.[0] ?? "";
    return {
      indentation,
      content: line.slice(indentation.length),
      isEmpty: line.trim().length === 0,
      original: line,
    };
  });
  const nonEmptyLines = parsedLines.filter((line) => !line.isEmpty);
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => line.content.startsWith(prefix));
  const transformedLines = parsedLines.map((line) => {
    if (line.isEmpty) {
      return line.original;
    }
    if (shouldRemove) {
      return line.indentation + line.content.slice(prefix.length);
    }
    if (line.content.startsWith(prefix)) {
      return line.original;
    }
    return line.indentation + prefix + line.content;
  });
  const transformed = transformedLines.join("\n");

  return {
    value: value.slice(0, lineStart) + transformed + value.slice(lineEnd),
    selectionStart: lineStart,
    selectionEnd: lineStart + transformed.length,
  };
}

export function insertLink(
  value: string,
  start: number,
  end: number
): EditResult {
  const safeStart = clamp(start, 0, value.length);
  const safeEnd = clamp(end, 0, value.length);
  const hasSelection = safeEnd > safeStart;
  const label = hasSelection ? value.slice(safeStart, safeEnd) : "text";
  const url = "https://example.com";
  const insertText = `[${label}](${url})`;
  const newValue =
    value.slice(0, safeStart) + insertText + value.slice(safeEnd);

  if (hasSelection) {
    const cursorPos = safeStart + insertText.length;
    return { value: newValue, selectionStart: cursorPos, selectionEnd: cursorPos };
  }

  const labelStart = safeStart + 1;
  const labelEnd = labelStart + label.length;
  return { value: newValue, selectionStart: labelStart, selectionEnd: labelEnd };
}

function insertBlock(
  value: string,
  start: number,
  end: number,
  block: string,
  selectionStartInBlock: number,
  selectionEndInBlock: number
): EditResult {
  const first = clamp(Math.min(start, end), 0, value.length);
  const last = clamp(Math.max(start, end), 0, value.length);
  const before = value.slice(0, first);
  const after = value.slice(last);
  const leadingSpacing =
    before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const trailingSpacing =
    after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const blockStart = before.length + leadingSpacing.length;

  return {
    value: before + leadingSpacing + block + trailingSpacing + after,
    selectionStart: blockStart + selectionStartInBlock,
    selectionEnd: blockStart + selectionEndInBlock,
  };
}

const TABLE_TEMPLATE = [
  "| Header 1 | Header 2 |",
  "| --- | --- |",
  "| Cell 1 | Cell 2 |",
].join("\n");

export function insertTable(
  value: string,
  start: number,
  end: number
): EditResult {
  const position = clamp(Math.max(start, end), 0, value.length);
  const headerStart = TABLE_TEMPLATE.indexOf("Header 1");
  return insertBlock(
    value,
    position,
    position,
    TABLE_TEMPLATE,
    headerStart,
    headerStart + "Header 1".length
  );
}

function getLongestBacktickRun(value: string): number {
  return Array.from(value.matchAll(/`+/g)).reduce(
    (longest, match) => Math.max(longest, match[0].length),
    0
  );
}

export function insertCodeBlock(
  value: string,
  start: number,
  end: number
): EditResult {
  const safeStart = clamp(Math.min(start, end), 0, value.length);
  const safeEnd = clamp(Math.max(start, end), 0, value.length);
  const selected = value.slice(safeStart, safeEnd);
  const code = selected || "code";
  const fence = "`".repeat(Math.max(3, getLongestBacktickRun(code) + 1));
  const block = `${fence}\n${code}${code.endsWith("\n") ? "" : "\n"}${fence}`;
  const codeStart = fence.length + 1;

  return insertBlock(
    value,
    safeStart,
    safeEnd,
    block,
    codeStart,
    codeStart + code.length
  );
}

export function parseTasks(body: string): ParsedTask[] {
  const lines = body.split("\n");
  const tasks: ParsedTask[] = [];
  const regex = /^\s*[-*+]\s+\[( |x|X)\]\s*(.*)$/;
  lines.forEach((line, index) => {
    const match = regex.exec(line);
    if (!match) {
      return;
    }
    tasks.push({
      line: index,
      checked: match[1].toLowerCase() === "x",
      text: match[2] ?? "",
    });
  });
  return tasks;
}
