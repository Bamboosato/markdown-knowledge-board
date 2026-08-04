import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { markdownHighlightExtension } from "../../src/lib/markdownHighlightExtension";
import {
  collectMarkdownMarkerRanges,
  type MarkdownMarkerRange,
} from "../../src/lib/markdownMarkerDecorations";

function collect(source: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [
      markdown({ extensions: [...GFM, markdownHighlightExtension] }),
    ],
  });

  return collectMarkdownMarkerRanges(state).map((range) => ({
    ...range,
    text: source.slice(range.from, range.to),
  }));
}

function matching(
  ranges: Array<MarkdownMarkerRange & { text: string }>,
  text: string,
) {
  return ranges.filter((range) => range.text === text);
}

describe("Markdown marker ranges", () => {
  it("normal: colors only parser-recognized CommonMark, GFM, and Highlight markers", () => {
    const source = [
      "# Heading",
      "Heading two\n---",
      "*em* **strong** ~~strike~~ ==mark==",
      "`inline`",
      "```ts\n# code **text** ==mark==\n```",
      "> quote",
      "- [x] task",
      "1. ordered",
      '[label](https://example.com "title") ![alt](image.png) <https://example.com>',
      "[reference][ref]",
      '[ref]: <https://reference.example> "Reference title"',
      "| A | B |\n| :- | -: |\n| x | y |",
      "***",
      "\\* escaped",
      "hard break\\\nnext",
    ].join("\n\n");
    const ranges = collect(source);
    const texts = ranges.map((range) => range.text);

    for (const marker of [
      "#",
      "---",
      "*",
      "**",
      "~~",
      "==",
      "`",
      "```",
      ">",
      "-",
      "[x]",
      "1.",
      "![",
      "<",
      ":",
      ":-",
      "-:",
      "***",
      "\\",
    ]) {
      expect(texts, `missing marker ${JSON.stringify(marker)}`).toContain(marker);
    }

    expect(matching(ranges, "==")).toHaveLength(2);
    expect(matching(ranges, "```")).toHaveLength(2);
    expect(
      ranges.some(
        (range) =>
          range.from > source.indexOf("# code") &&
          range.to < source.indexOf("\n```", source.indexOf("# code")),
      ),
    ).toBe(false);

    for (const content of [
      "Heading",
      "em",
      "strong",
      "strike",
      "mark",
      "inline",
      "label",
      "alt",
      "https://example.com",
      "title",
      "reference",
      "ref",
      "Reference title",
      "A",
      "x",
    ]) {
      expect(texts, `content was colored: ${content}`).not.toContain(content);
    }
  });

  it("invalid and boundary: leaves unclosed, multiline, triple equals, and plain pipes uncolored", () => {
    const source = [
      "plain * ** ~~ ==unclosed | pipe",
      "==across",
      "lines==",
      "===triple===",
      "`# ** == |`",
      "\\* escaped",
    ].join("\n");
    const ranges = collect(source);

    expect(ranges.map((range) => range.text)).toEqual(["`", "`", "\\"]);
  });

  it("data boundary: reports UTF-16 offsets without splitting a surrogate pair", () => {
    const source = "😀 **強調**";

    expect(collect(source)).toEqual([
      { from: 3, to: 5, nodeName: "EmphasisMark", text: "**" },
      { from: 7, to: 9, nodeName: "EmphasisMark", text: "**" },
    ]);
  });
});
