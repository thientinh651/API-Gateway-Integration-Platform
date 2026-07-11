/** Parse redirect URI textarea — mỗi dòng hoặc nhiều URL dính liền. */
export function parseRedirectUrisInput(text: string): string[] {
  const parts = text
    .split(/(?=https?:\/\/)/i)
    .flatMap((chunk) => chunk.split(/\r?\n/))
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export function formatRedirectUrisForInput(uris: string[]): string {
  return uris.join('\n');
}
