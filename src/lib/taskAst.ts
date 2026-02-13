import { remark } from "remark";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

type Position = {
  start?: { line?: number };
};

type ListItemNode = {
  type: string;
  checked?: boolean;
  position?: Position;
  children?: ListItemNode[];
};

export function getTaskLineIndexes(body: string): number[] {
  const tree = remark().use(remarkParse).use(remarkGfm).parse(body) as ListItemNode;
  const lines: number[] = [];

  const walk = (node: ListItemNode) => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const line = node.position?.start?.line;
      if (typeof line === "number") {
        lines.push(line - 1);
      }
    }
    if (node.children) {
      node.children.forEach(walk);
    }
  };

  walk(tree);
  return lines;
}
