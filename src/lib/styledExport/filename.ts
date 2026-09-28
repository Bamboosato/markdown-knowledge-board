export function sanitizeDownloadName(name: string): string {
  return name.replace(/[\\/:*?"<>|%]/g, "_").trim();
}
