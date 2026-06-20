/** Khớp mask backend (`mask_api_key_for_log`) — 6 ký tự đầu + … */
export function maskApiKeyForLog(key: string): string {
  const k = key.trim();
  if (!k) return '(none)';
  if (k.length <= 4) return '****';
  return `${k.slice(0, 6)}…`;
}
