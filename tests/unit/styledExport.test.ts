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
