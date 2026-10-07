import { describe, expect, it } from "vitest";

import {
  parseImportFileContent,
  parseMarkdownBodyFileContent,
} from "../../src/lib/backup";
import {
  areCustomMetadataEqual,
  buildFrontmatterEntries,
  cloneCustomMetadata,
  parseFrontmatterValueText,
  parseMarkdownWithFrontmatter,
  serializeFrontmatterValue,
  toMarkdownWithFrontmatter,
} from "../../src/lib/frontmatter";
import { validateBackupDocument } from "../../src/lib/cloudRestore";
import type { FrontmatterValue, Note } from "../../src/lib/types";

// A small input describes many expanded values, without executing a large payload.
function aliasGraph(levels = 4): string {
  const lines = ["a0: &a0 [leaf, leaf, leaf, leaf, leaf, leaf, leaf, leaf, leaf, leaf]"];
  for (let level = 1; level <= levels; level += 1) {
    lines.push(`a${level}: &a${level} [${Array(10).fill(`*a${level - 1}`).join(", ")}]`);
  }
  return lines.join("\n");
}

const markdown = (yaml: string) => `---\n${yaml}\n---\nBody`;
const sizeError = /Metadata expands beyond/;

function note(value: FrontmatterValue): Note {
  return {
    id: "note",
    title: "Note",
    tags: [],
    updatedAt: 100,
    body: "Body",
    customMetadata: [{ key: "data", value }],
  };
}

describe("bounded frontmatter expansion", () => {
  it("preserves small aliases, typed nested values, Unicode and literal anchor characters", () => {
    const source = "base: &base [日本語, 2, true, null]\ncopy: *base\nliteral: '*not-an-alias &text'";
    const parsed = parseMarkdownWithFrontmatter(markdown(source));
    expect(parsed.customMetadata).toEqual([
      { key: "base", value: ["日本語", 2, true, null] },
      { key: "copy", value: ["日本語", 2, true, null] },
      { key: "literal", value: "*not-an-alias &text" },
    ]);
    expect(parseMarkdownWithFrontmatter(toMarkdownWithFrontmatter(note(parsed.customMetadata![0].value))).customMetadata)
      .toEqual([{ key: "data", value: ["日本語", 2, true, null] }]);
  });

  it.each([
    ["Markdown import", (input: string) => parseImportFileContent(markdown(input), "hostile.md", "markdown")],
    ["body replacement", (input: string) => parseMarkdownBodyFileContent(markdown(input), "hostile.md")],
    ["metadata editor", parseFrontmatterValueText],
    ["reserved field", (input: string) => parseMarkdownWithFrontmatter(markdown(`title:\n${input.split("\n").map(line => `  ${line}`).join("\n")}`))],
    ["top-level sequence", (input: string) => parseMarkdownWithFrontmatter(markdown(`-\n${input.split("\n").map(line => `  ${line}`).join("\n")}`))],
  ])("rejects alias expansion through %s before copying values", (_label, parse) => {
    expect(() => parse(aliasGraph())).toThrow(sizeError);
  });

  it("rejects recursive aliases and resets the budget after an error", () => {
    expect(() => parseFrontmatterValueText("&self [*self]")).toThrow(/circular/);
    expect(parseFrontmatterValueText("[one, 2]")).toEqual(["one", 2]);
  });

  it("counts siblings together rather than granting each field a fresh budget", () => {
    const yaml = Array.from({ length: 11 }, (_, index) => `field${index}: [${Array(1000).fill("x").join(",")}]`).join("\n");
    expect(() => parseMarkdownWithFrontmatter(markdown(yaml))).toThrow(sizeError);
  });

  it("keeps accepted managed scalars displayable without charging internal note wrappers", () => {
    const title = "x".repeat(999_995);
    const parsed = parseImportFileContent(markdown(`title: '${title}'`), "valid.md", "markdown");
    expect(buildFrontmatterEntries(parsed[0]).find((entry) => entry.key === "title")?.value)
      .toBe(title);
  });

  it("checks the stored collection representation before accepting imported metadata", () => {
    const yaml = Array.from({ length: 1000 }, (_, index) =>
      `field${index}: [${Array(8).fill("null").join(",")}]`
    ).join("\n");
    // The YAML graph fits, but the entry wrappers used by the app do not.
    expect(() => parseMarkdownWithFrontmatter(markdown(yaml))).toThrow(sizeError);
  });

  it("accepts exactly 10,000 expanded values and rejects the next value", () => {
    // Root + ten arrays + 9,989 scalar leaves = 10,000 visited values.
    const value = [...Array.from({ length: 9 }, () => Array(1000).fill(null)), Array(989).fill(null)];
    expect(parseFrontmatterValueText(JSON.stringify(value))).toEqual(value);
    value[9].push(null);
    expect(() => parseFrontmatterValueText(JSON.stringify(value))).toThrow(sizeError);
  });

  it("bounds expanded string and key characters, including repeated scalar aliases", () => {
    expect(parseFrontmatterValueText(JSON.stringify("x".repeat(1_000_000)))).toHaveLength(1_000_000);
    expect(() => parseFrontmatterValueText(JSON.stringify("x".repeat(1_000_001)))).toThrow(sizeError);
    const yaml = `base: &base '${"x".repeat(2000)}'\ncopies: [${Array(1000).fill("*base").join(",")}]`;
    expect(() => parseFrontmatterValueText(yaml)).toThrow(sizeError);
    expect(() => parseFrontmatterValueText(`${"k".repeat(1_000_001)}: null`)).toThrow(sizeError);
  });

  it("guards programmatic alias graphs at copy, equality, export and cloud validation boundaries", () => {
    let value: FrontmatterValue = Array(10).fill("leaf");
    for (let level = 0; level < 4; level += 1) {
      value = Array(10).fill(value);
    }
    const input = note(value);
    expect(() => cloneCustomMetadata(input.customMetadata)).toThrow(sizeError);
    expect(() => areCustomMetadataEqual(input.customMetadata, [])).toThrow(sizeError);
    expect(() => serializeFrontmatterValue(value)).toThrow(sizeError);
    expect(() => toMarkdownWithFrontmatter(input)).toThrow(sizeError);
    expect(() => validateBackupDocument({
      app: "markdown-knowledge-board",
      version: 1,
      createdAt: "2026-10-07T00:00:00Z",
      noteCount: 1,
      notes: [{
        id: "note",
        title: "Note",
        tags: [],
        updatedAt: 100,
        markdown: "Body",
        customMetadata: input.customMetadata,
      }],
    })).toThrow(sizeError);
  });
});
