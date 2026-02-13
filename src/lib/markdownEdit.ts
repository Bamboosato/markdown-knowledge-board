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
