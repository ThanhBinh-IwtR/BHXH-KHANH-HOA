export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse one RFC 9110 byte range. Returns null when the header is absent,
 * malformed or asks for several ranges (the full file is served instead), and
 * 'unsatisfiable' when the range starts beyond the end of the file.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header || size === 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return 'unsatisfiable';
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return null;
  return { start, end };
}
