const taskMarkerPattern = /^(\s*[-*]\s*)\[( |x|X)\]\s+/;

export function getTaskLineIndexes(body: string): number[] {
  const lines = body.split("\n");
  const indexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (taskMarkerPattern.test(lines[i])) {
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
  const match = taskMarkerPattern.exec(line);
  if (!match) {
    return body;
  }
  lines[lineIndex] = line.replace(
    taskMarkerPattern,
    (_m, p1: string, mark: string) => {
      const next = mark.toLowerCase() === "x" ? " " : "x";
      return `${p1}[${next}] `;
    }
  );
  return lines.join("\n");
}
