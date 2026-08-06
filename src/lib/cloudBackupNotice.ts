export function cloudBackupCompletedMessage(noteCount: number): string {
  if (noteCount === 0) {
    return 'Cloud backup completed. The encrypted backup contains no notes.'
  }
  const noteLabel = noteCount === 1 ? 'note was' : 'notes were'
  return `Cloud backup completed. ${noteCount} ${noteLabel} encrypted and saved to GitHub.`
}
