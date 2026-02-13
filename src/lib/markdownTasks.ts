export function getTaskLineIndexes(body: string): number[] {
  const lines = body.split("\n");
  const indexes: number[] = [];
  const regex = /^\s*[-*]\s*\[( |x|X)\]\s+/;
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      indexes.push(i);
    }
  }
  return indexes;
}

export function toggleTaskAtLine(body: string, lineIndex: number): string {
  const lines = body.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return body;
  }
  const line = lines[lineIndex];
  if (!/^\s*[-*]\s*\[( |x|X)\]\s+/.test(line)) {
    return body;
  }
  const match = /^(\s*[-*]\s*)\[( |x|X)\]\s+/.exec(line);
  if (!match) {
    return body;
  }
  const nextChecked = match[2].toLowerCase() !== "x";
  lines[lineIndex] = line.replace(
    /^(\s*[-*]\s*)\[( |x|X)\]\s+/,
    (_m, p1: string, mark: string) => {
      const next = mark.toLowerCase() === "x" ? " " : "x";
      return `${p1}[${next}] `;
    }
  );
  return lines.join("\n");
}
