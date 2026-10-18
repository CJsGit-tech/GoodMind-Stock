export const MAX_ETF_COVER_BYTES = 1024 * 1024;
export const MAX_ETF_COVER_BASE64_CHARS = 4 * Math.ceil(MAX_ETF_COVER_BYTES / 3);
export type EtfCoverInput = { contentBase64: string; filename: string };
export type EtfCoverMetadata = { sha256: string; bytes: number; width: 480; height: 360; contentType: 'image/jpeg' };
export type EtfCoverDescriptor = EtfCoverMetadata & { url: string };
export type EtfCoverIssue = { path: string; code: string; message: string };
export type ValidatedEtfCover = EtfCoverMetadata & { contentBase64: string };
export type EtfCoverValidation = { cover: ValidatedEtfCover | null; errors: EtfCoverIssue[] };

// This validates JPEG segment structure, not entropy-decoded pixels. Author also decodes the image before preview.
function isCoverJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return false;
  let offset = 2, frame = false, scan = false, quantization = false, huffman = false;
  const components = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) return frame && scan && quantization && huffman && offset === bytes.length;
    if (marker === undefined || ![192, 193, 194, 196, 218, 219, 221, 254].includes(marker) && !(marker >= 224 && marker <= 239)) return false;
    if (offset + 2 > bytes.length) return false;
    const size = bytes[offset] * 256 + bytes[offset + 1], end = offset + size;
    if (size < 2 || end > bytes.length) return false;
    if ([192, 193, 194].includes(marker)) {
      if (frame || scan || size !== 17 || bytes[offset + 2] !== 8 || bytes[offset + 3] * 256 + bytes[offset + 4] !== 360 || bytes[offset + 5] * 256 + bytes[offset + 6] !== 480 || bytes[offset + 7] !== 3) return false;
      for (let i = 0; i < 3; i++) {
        const id = bytes[offset + 8 + 3 * i], sample = bytes[offset + 9 + 3 * i];
        if (components.has(id) || (sample >> 4) < 1 || (sample >> 4) > 4 || (sample & 15) < 1 || (sample & 15) > 4 || bytes[offset + 10 + 3 * i] > 3) return false;
        components.add(id);
      }
      frame = true;
    }
    if (marker === 219) {
      if (size === 2) return false;
      let p = offset + 2;
      while (p < end) {
        const table = bytes[p++];
        if ((table >> 4) > 1 || (table & 15) > 3) return false;
        p += 64 * ((table >> 4) + 1);
      }
      if (p !== end) return false;
      quantization = true;
    }
    if (marker === 196) {
      if (size === 2) return false;
      let p = offset + 2;
      while (p < end) {
        const table = bytes[p++];
        if ((table >> 4) > 1 || (table & 15) > 3 || p + 16 > end) return false;
        let symbols = 0;
        for (let i = 0; i < 16; i++) symbols += bytes[p++];
        if (!symbols || symbols > 256) return false;
        p += symbols;
      }
      if (p !== end) return false;
      huffman = true;
    }
    if (marker === 221 && size !== 4) return false;
    if (marker === 238 && size >= 14 && String.fromCharCode(...bytes.slice(offset + 2, offset + 7)) === 'Adobe' && bytes[offset + 13] === 2) return false;
    if (marker === 218) {
      const count = bytes[offset + 2], ids = new Set<number>();
      if (!frame || !quantization || !huffman || count < 1 || count > 3 || size !== 6 + 2 * count) return false;
      for (let i = 0; i < count; i++) {
        const id = bytes[offset + 3 + 2 * i], tables = bytes[offset + 4 + 2 * i];
        if (!components.has(id) || ids.has(id) || (tables >> 4) > 3 || (tables & 15) > 3) return false;
        ids.add(id);
      }
      scan = true;
      offset = end;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 255) continue;
        const start = offset - 1;
        while (bytes[offset] === 255) offset++;
        const code = bytes[offset++];
        if (code === 0 || code >= 208 && code <= 215) continue;
        offset = start;
        break;
      }
      continue;
    }
    offset = end;
  }
  return false;
}

export async function validateEtfCover(input: unknown): Promise<EtfCoverValidation> {
  const invalid = (message: string, code = 'invalid_cover', path = 'cover'): EtfCoverValidation => ({ cover: null, errors: [{ path, code, message }] });
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return invalid('封面需為 JPG 檔案資料。');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'contentBase64,filename') return invalid('封面僅接受檔名與檔案內容。');
  if (typeof value.filename !== 'string' || !/^[^/\\<>:"|?*\x00-\x1f\x7f]{1,120}\.jpe?g$/i.test(value.filename) || value.filename.includes('..')) return invalid('請選擇檔名安全的 JPG 封面。', 'invalid_cover', 'cover.filename');
  const content = value.contentBase64;
  if (typeof content !== 'string' || !content.length) return invalid('需要 JPG 封面內容。');
  if (content.length > MAX_ETF_COVER_BASE64_CHARS) return invalid('封面不得超過 1 MiB。', 'cover_too_large');
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) return invalid('封面內容需為有效 base64。');
  let binary: string;
  try { binary = atob(content); } catch { return invalid('封面內容需為有效 base64。'); }
  if (binary.length > MAX_ETF_COVER_BYTES) return invalid('封面不得超過 1 MiB。', 'cover_too_large');
  if (btoa(binary) !== content) return invalid('封面 base64 編碼不完整。');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!isCoverJpeg(bytes)) return invalid('封面需為完整的 480 × 360、8-bit RGB JPG。');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { cover: { sha256, bytes: bytes.length, width: 480, height: 360, contentType: 'image/jpeg', contentBase64: content }, errors: [] };
}
