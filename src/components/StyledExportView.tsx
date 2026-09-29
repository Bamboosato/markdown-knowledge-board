import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { X } from "lucide-react";
import styledExportDocumentCss from "../lib/styledExport/document.css?inline";

import { StyledDocument } from "./StyledDocument";
import { getThemeVariables } from "../lib/styledExport/theme";
import { renderMermaidSvg } from "../lib/mermaidRenderer";
import {
  fileToSafeDataUrl,
  resolveDirectImage,
  setAsset,
  STYLED_EXPORT_TOTAL_IMAGE_LIMIT,
} from "../lib/styledExport/assets";
import { analyzeStyledMarkdown } from "../lib/styledExport/markdown";
import type {
  StyledAssetMap,
  StyledExportIssue,
  StyledExportOptions,
  StyledImageReference,
} from "../lib/styledExport/types";
import {
  DEFAULT_STYLED_EXPORT_OPTIONS,
  STYLED_EXPORT_COLORS,
  STYLED_EXPORT_DESIGNS,
  STYLED_EXPORT_TEXT_SCALES,
} from "../lib/styledExport/types";
import { sanitizeDownloadName } from "../lib/styledExport/filename";

type StyledExportSnapshot = {
  title: string;
  body: string;
  tags: string[];
};

type StyledExportViewProps = {
  snapshot: StyledExportSnapshot;
  onBackToPreview: () => void;
};

const htmlStyle = (title: string) => `body{margin:0;padding:32px 16px;background:var(--styled-canvas,#eef1f5);color:var(--styled-text,#26303b)}@media(max-width:640px){body{padding:10px 0}}@media print{body{padding:0;background:#fff}}@page{size:A4 portrait;margin:18mm 14mm;@top-center{content:${toCssString(title)}}@bottom-right{content:counter(page) " / " counter(pages)}}`;

function toCssString(value: string) {
  return `"${Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    if (character === "\\" || character === '"' || codePoint < 0x20 || codePoint === 0x7f || character === "<") {
      return `\\${codePoint.toString(16)} `;
    }
    return character;
  }).join("")}"`;
}

function getIssueKey(issue: StyledExportIssue) {
  return `${issue.id}:${issue.reason}`;
}

export function StyledExportView({ snapshot, onBackToPreview }: StyledExportViewProps) {
  const [options, setOptions] = useState<StyledExportOptions>(() => ({
    ...DEFAULT_STYLED_EXPORT_OPTIONS,
  }));
  const [assets, setAssets] = useState<StyledAssetMap>({});
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const [mermaidSvgs, setMermaidSvgs] = useState<Record<string, string>>({});
  const [mermaidErrors, setMermaidErrors] = useState<string[]>([]);
  const [isPreparingDocument, setIsPreparingDocument] = useState(true);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [allowLocalLinks, setAllowLocalLinks] = useState(false);
  const [showLocalLinkDetails, setShowLocalLinkDetails] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const remoteAbortRef = useRef<AbortController | null>(null);
  const isPrintingRef = useRef(false);
  const printRequestRef = useRef(0);
  const printCleanupRef = useRef<(() => void) | null>(null);
  const analysis = useMemo(
    () => analyzeStyledMarkdown(snapshot.body),
    [snapshot.body]
  );

  useEffect(() => {
    backButtonRef.current?.focus();
    let active = true;
    const init = async () => {
      const initialAssets: StyledAssetMap = {};
      const initialErrors: Record<string, string> = {};
      await Promise.all(analysis.images.filter((image) => image.url.startsWith("data:image/"))
        .map(async (image) => {
          try {
            const resolved = await resolveDirectImage(image.url);
            Object.assign(initialAssets, setAsset(initialAssets, image, resolved));
          } catch (error) {
            initialErrors[image.id] = getErrorMessage(error);
          }
        }));
      const rendered: Record<string, string> = {};
      const failures: string[] = [];
      await Promise.all(analysis.mermaidCodes.map(async (code, index) => {
        try {
          rendered[code] = await renderMermaidSvg(code, `styled-export-${index}`, true);
        } catch {
          failures.push(code);
        }
      }));
      if (active) {
        setAssets(initialAssets);
        setAssetErrors(initialErrors);
        setMermaidSvgs(rendered);
        setMermaidErrors(failures);
        setIsPreparingDocument(false);
      }
    };
    void init();
    return () => { active = false; };
  }, [analysis]);

  useEffect(() => () => {
    remoteAbortRef.current?.abort();
    printRequestRef.current += 1;
    printCleanupRef.current?.();
    document.body.classList.remove("styled-export-printing");
  }, []);

  const unresolvedImages = analysis.images.filter((image) => !assets[image.id] || assetErrors[image.id]);
  const localLinkIssues = analysis.issues.filter((issue) => issue.kind === "local-link");
  const otherIssues = analysis.issues.filter((issue) => issue.kind === "unsafe-link");

  const changeOption = <K extends keyof StyledExportOptions>(key: K, value: StyledExportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const loadRemoteImages = async () => {
    if (remoteAbortRef.current) return;
    setIsLoadingRemote(true);
    const controller = new AbortController();
    remoteAbortRef.current = controller;
    const nextAssets = { ...assets };
    const errors = { ...assetErrors };
    const remoteImages = unresolvedImages.filter((image) => /^https:\/\//i.test(image.url));
    for (const [index, image] of remoteImages.entries()) {
      if (controller.signal.aborted) break;
      setStatusMessage(`Loading external image ${index + 1} of ${remoteImages.length}…`);
      try {
        const result = await resolveDirectImage(image.url, controller.signal);
        Object.assign(nextAssets, setAsset(nextAssets, image, result));
        delete errors[image.id];
      } catch (error) {
        if (!controller.signal.aborted) errors[image.id] = getErrorMessage(error);
      }
    }
    if (controller.signal.aborted) return;
    setAssets(nextAssets);
    setAssetErrors(errors);
    setIsLoadingRemote(false);
    remoteAbortRef.current = null;
    setStatusMessage("External image check complete. Review any unresolved images below.");
  };

  const chooseImage = async (image: StyledImageReference, file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await fileToSafeDataUrl(file);
      setAssets(setAsset(assets, image, dataUrl));
      setAssetErrors((current) => {
        const next = { ...current };
        delete next[image.id];
        return next;
      });
    } catch (error) {
      setAssetErrors((current) => ({ ...current, [image.id]: getErrorMessage(error) }));
    }
  };

  const renderDocument = (printClass = "styled-export-document") => renderToStaticMarkup(
    <StyledDocument
      title={snapshot.title}
      tags={snapshot.tags}
      markdown={snapshot.body}
      options={options}
      analysis={analysis}
      assets={assets}
      mermaidSvgs={mermaidSvgs}
      allowLocalLinks={allowLocalLinks}
      className={printClass}
    />
  );

  const isReady = !isPreparingDocument && unresolvedImages.length === 0 && (localLinkIssues.length === 0 || allowLocalLinks);

  const downloadHtml = () => {
    if (!isReady) {
      setStatusMessage("Resolve all images and review local-link warnings before exporting.");
      return;
    }
    const title = snapshot.title.trim();
    const body = renderDocument();
    const bodyStyle = Object.entries(getThemeVariables(options))
      .map(([property, value]) => `${property}:${value}`)
      .join(";");
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title || "Untitled")}</title><style>${htmlStyle(title || "Untitled")}${styledExportDocumentCss}</style></head><body style="${escapeHtml(bodyStyle)}">${body}</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeDownloadName(title) || "note"}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusMessage("HTML download started. Check your browser’s download list.");
  };

  const printDocument = async () => {
    if (!isReady || isPrinting || isPrintingRef.current) {
      setStatusMessage("Resolve all images and review local-link warnings before printing.");
      return;
    }
    isPrintingRef.current = true;
    setIsPrinting(true);
    setStatusMessage("Preparing print preview…");
    document.body.classList.add("styled-export-printing");
    const requestId = ++printRequestRef.current;
    const previousTitle = document.title;
    const printTitle = snapshot.title.trim() || "Untitled";
    document.title = `${sanitizeDownloadName(printTitle)} - Markdown Knowledge Board`;
    const pageTitleStyle = document.createElement("style");
    pageTitleStyle.textContent = `@page{@top-center{content:${toCssString(printTitle)}}}`;
    document.head.appendChild(pageTitleStyle);
    let cleanupTimer: number | null = null;
    const cleanup = () => {
      if (printCleanupRef.current !== cleanup) return;
      printCleanupRef.current = null;
      if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
      document.title = previousTitle;
      pageTitleStyle.remove();
      document.body.classList.remove("styled-export-printing");
      isPrintingRef.current = false;
      if (requestId === printRequestRef.current) setIsPrinting(false);
      window.removeEventListener("afterprint", cleanup);
    };
    printCleanupRef.current = cleanup;
    try {
      await Promise.race([
        Promise.all([
          document.fonts.ready,
          ...Array.from(document.querySelectorAll<HTMLImageElement>(".styled-export-preview-wrap img"))
            .map((image) => image.decode()),
        ]),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error("Print content did not finish loading.")), 10_000)),
      ]);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (requestId !== printRequestRef.current) return;
      window.addEventListener("afterprint", cleanup);
      cleanupTimer = window.setTimeout(cleanup, 60_000);
      window.print();
      setStatusMessage("");
    } catch (error) {
      cleanup();
      if (requestId === printRequestRef.current) {
        setStatusMessage(`${getErrorMessage(error)} Try again or choose another image.`);
      }
    }
  };

  const remoteImagesAvailable = unresolvedImages.some((image) => /^https:\/\//i.test(image.url));
  const remoteImagesFailed = unresolvedImages.some((image) => /^https:\/\//i.test(image.url) && assetErrors[image.id]);
  const issues = [
    ...unresolvedImages.map((image) => ({
      key: image.id,
      label: `Image at line ${image.position.line}: ${image.url}`,
      message: assetErrors[image.id] || (/^https:\/\//i.test(image.url)
        ? "Load this HTTPS image or choose a local file."
        : "Choose a local image file to continue."),
      image,
    })),
    ...otherIssues.map((issue) => ({ key: getIssueKey(issue), label: `Link at line ${issue.position.line}: ${issue.reference}`, message: issue.reason, image: null })),
    ...mermaidErrors.map((_, index) => ({ key: `mermaid-${index}`, label: `Mermaid block ${index + 1}`, message: "Diagram could not be rendered; the source code will be included.", image: null })),
  ];

  return (
    <>
      <div className="editor-tabs styled-export-view-heading">
        <h2 id="styled-export-title">Export Styled HTML / PDF</h2>
        <div className="styled-export-heading-actions">
          <button type="button" className="secondary-button" onClick={printDocument} disabled={!isReady || isPrinting}>{isPrinting ? "Opening print…" : "Print / PDF"}</button>
          <button type="button" className="primary-button" onClick={downloadHtml} disabled={!isReady}>Download HTML</button>
          <button ref={backButtonRef} type="button" className="secondary-button styled-export-close-button" aria-label="Back to Preview" title="Back to Preview" onClick={onBackToPreview}><X aria-hidden="true" /></button>
        </div>
      </div>
      <section className="styled-export-view editor-body" aria-labelledby="styled-export-title">
        <style>{styledExportDocumentCss}</style>
        <div className="styled-export-controls">
          <label>Color<select value={options.colorId} onChange={(event) => changeOption("colorId", event.target.value as StyledExportOptions["colorId"])}>{STYLED_EXPORT_COLORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Design<select value={options.designId} onChange={(event) => changeOption("designId", event.target.value as StyledExportOptions["designId"])}>{STYLED_EXPORT_DESIGNS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Text size<select value={options.textScale} onChange={(event) => changeOption("textScale", Number(event.target.value) as StyledExportOptions["textScale"])}>{STYLED_EXPORT_TEXT_SCALES.map((scale) => <option key={scale} value={scale}>{scale}%</option>)}</select></label>
          <label className="styled-export-tags-toggle"><input type="checkbox" checked={options.showTags} onChange={(event) => changeOption("showTags", event.target.checked)} /> Show tags</label>
        </div>
        <p className="styled-export-status" role="status" aria-live="polite">{statusMessage}</p>
        {issues.length ? (
          <section className="styled-export-issues" aria-label="Export checks">
            <div className="styled-export-issues-heading">
              <h3>Review before export</h3>
              {remoteImagesAvailable ? <button type="button" className="secondary-button styled-export-load-remote" disabled={isLoadingRemote} onClick={() => void loadRemoteImages()}>{isLoadingRemote ? "Loading HTTPS images…" : remoteImagesFailed ? "Retry HTTPS images" : "Load HTTPS images"}</button> : null}
            </div>
            {remoteImagesAvailable ? <p className="styled-export-remote-note">Load the HTTPS images listed below, or choose a local file for each image. Loading connects anonymously to the image server. Images are limited to 5 MiB each and {STYLED_EXPORT_TOTAL_IMAGE_LIMIT / (1024 * 1024)} MiB total, embedded in the output, and not saved in the app.</p> : null}
            <ul>{issues.map((issue) => <li key={issue.key}><div><strong>{issue.label}</strong><span>{issue.message}</span></div>{issue.image ? <label className="secondary-button styled-export-file-picker">{/^https:\/\//i.test(issue.image.url) ? "Or choose a local image" : "Choose a local image"}<input className="visually-hidden" type="file" aria-label={`Choose a local image for line ${issue.image.position.line}`} accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void chooseImage(issue.image!, file); }} /></label> : null}</li>)}</ul>
          </section>
        ) : null}
        {localLinkIssues.length ? (
          <section className="styled-export-local-links" aria-label="Local link warnings">
            {allowLocalLinks && !showLocalLinkDetails ? (
              <div className="styled-export-local-summary" role="status" aria-live="polite">
                <span>{localLinkIssues.length} local {localLinkIssues.length === 1 ? "link" : "links"} will be omitted from the output.</span>
                <button type="button" className="styled-export-review-link" aria-expanded="false" onClick={() => setShowLocalLinkDetails(true)}>Review</button>
                <label className="styled-export-continue"><input type="checkbox" checked onChange={() => { setAllowLocalLinks(false); setShowLocalLinkDetails(true); }} /> Continue without local links</label>
              </div>
            ) : (
              <div className="styled-export-issues styled-export-local-issues">
                <div className="styled-export-local-issues-heading">
                  <h3>Local links ({localLinkIssues.length})</h3>
                  {allowLocalLinks ? <button type="button" className="styled-export-review-link" aria-expanded="true" onClick={() => setShowLocalLinkDetails(false)}>Hide details</button> : null}
                </div>
                <ul>{localLinkIssues.map((issue) => <li key={getIssueKey(issue)}><div><strong>Line {issue.position.line}: {issue.reference}</strong><span>{issue.reason}</span></div></li>)}</ul>
                <label className="styled-export-continue"><input type="checkbox" checked={allowLocalLinks} onChange={(event) => { setAllowLocalLinks(event.target.checked); setShowLocalLinkDetails(!event.target.checked); }} /> Continue without local links</label>
              </div>
            )}
          </section>
        ) : null}
        <div className="styled-export-preview-wrap" aria-label="Styled export preview" style={getThemeVariables(options)}>
          <StyledDocument title={snapshot.title} tags={snapshot.tags} markdown={snapshot.body} options={options} analysis={analysis} assets={assets} mermaidSvgs={mermaidSvgs} allowLocalLinks={allowLocalLinks} />
        </div>
      </section>
    </>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}
