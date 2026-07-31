import type { Root } from "mdast";
import type { Plugin } from "unified";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

function containsLineBreak(node: MarkdownNode): boolean {
  if (typeof node.value === "string" && /\r|\n/.test(node.value)) {
    return true;
  }
  return node.children?.some(containsLineBreak) ?? false;
}

function restoreMultilineMarkers(parent: MarkdownNode): void {
  if (!parent.children) {
    return;
  }

  const nextChildren: MarkdownNode[] = [];
  parent.children.forEach((child) => {
    if (child.type === "mark" && containsLineBreak(child)) {
      nextChildren.push(
        { type: "text", value: "==" },
        ...(child.children ?? []),
        { type: "text", value: "==" }
      );
      return;
    }

    restoreMultilineMarkers(child);
    nextChildren.push(child);
  });
  parent.children = nextChildren;
}

export const remarkSingleLineHighlight: Plugin<[], Root> = () => (tree) => {
  restoreMultilineMarkers(tree as unknown as MarkdownNode);
};
