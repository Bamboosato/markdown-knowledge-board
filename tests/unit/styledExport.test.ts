import { describe, expect, it } from "vitest";
import { resolveDirectImage } from "../../src/lib/styledExport/assets";
import { sanitizeDownloadName } from "../../src/lib/styledExport/filename";
import { analyzeStyledMarkdown, slugifyHeading } from "../../src/lib/styledExport/markdown";

describe("styled export document references", () => {
  it("creates Unicode heading IDs and resolves in-document links", () => {
    const result = analyzeStyledMarkdown("# 目的 と 概要\n\n[戻る](#目的%20と%20概要)\n\n## 重複\n\n## 重複");

    expect(slugifyHeading("目的 と 概要")).toBe("目的-と-概要");
    expect(result.headingIds.get(1)).toBe("目的-と-概要");
    expect(result.headingIds.get(5)).toBe("重複");
    expect(result.headingIds.get(7)).toBe("重複-1");
    expect(result.issues).toEqual([]);
  });

  it("reports missing anchors and local links", () => {
    const result = analyzeStyledMarkdown("[missing](#absent)\n\n[local](./note.md)");

    expect(result.issues.map((issue) => issue.kind)).toEqual(["local-link", "local-link"]);
  });

  it("uses unique heading IDs for duplicate suffixes and reserved footnote IDs", () => {
    const result = analyzeStyledMarkdown("## A\n\n## A\n\n## A-1\n\n## user-content-fn-note\n\n## footnote-label\n\nFootnote[^note].\n\n[^note]: text");
    const ids = [...result.headingIds.values()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 3)).toEqual(["a", "a-1", "a-1-1"]);
    expect(ids[3]).not.toMatch(/^user-content-(fn|fnref)-/);
    expect(ids[4]).not.toBe("footnote-label");
    expect(result.headingIdBySlug.get("a")).toBe("a");
    expect(result.tocEntries.map((entry) => entry.id)).toEqual(ids);
  });

  it("extracts only text headings and retains heading order and level", () => {
    const result = analyzeStyledMarkdown("### Earlier\n\n## **Hello** `code` [link](https://example.com)\n\n## ![image](image.png)\n\n### 日本語");
    expect(result.tocEntries.map(({ level, label }) => ({ level, label }))).toEqual([
      { level: 3, label: "Earlier" }, { level: 2, label: "Hello code link" }, { level: 3, label: "日本語" },
    ]);
  });

  it("preserves existing heading IDs when they do not collide with actual footnotes", () => {
    const result = analyzeStyledMarkdown("## footnote-label\n\n## user-content-fn-other\n\n[^note]: note");
    expect([...result.headingIds.values()]).toEqual(["footnote-label", "user-content-fn-other"]);
  });

  it("replaces forbidden filename characters", () => {
    expect(sanitizeDownloadName("企画: A/B?")).toBe("企画_ A_B_");
  });
});

describe("styled export embedded images", () => {
  it("rejects raster data that does not match its MIME type", async () => {
    await expect(resolveDirectImage("data:image/png;base64,AA=="))
      .rejects.toThrow("Image data does not match its declared image type.");
  });
});
