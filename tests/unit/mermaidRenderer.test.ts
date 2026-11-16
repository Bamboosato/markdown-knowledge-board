import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: api }));
vi.mock("../../src/lib/sanitizeSvg", () => ({ sanitizeSvg: (svg: string) => svg }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

it("isolates concurrent print/screen configuration and continues after a parse failure", async () => {
  let rejectFirst!: (error: Error) => void;
  api.render.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockResolvedValueOnce({ svg: "<svg/>" });
  const { renderMermaidSvg } = await import("../../src/lib/mermaidRenderer");
  const print = renderMermaidSvg("broken", "print", false, true);
  const rejected = expect(print).rejects.toThrow("parse failure");
  const screen = renderMermaidSvg("graph TD\nA-->B", "screen");
  await vi.waitFor(() => expect(api.render).toHaveBeenCalledTimes(1));
  expect(api.initialize).toHaveBeenCalledTimes(1);
  expect(api.initialize.mock.calls[0][0]).toMatchObject({ suppressErrorRendering: true, flowchart: { rankSpacing: 12 } });
  rejectFirst(new Error("parse failure"));
  await rejected;
  await expect(screen).resolves.toBe("<svg/>");
  expect(api.initialize.mock.calls[1][0]).not.toHaveProperty("flowchart");
  expect(api.initialize.mock.calls[1][0]).toMatchObject({ securityLevel: "strict", htmlLabels: false });
});
