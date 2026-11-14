// Builds a multipart/form-data body by hand, so a test controls every byte of
// a part's header (a file name with a backslash, a NUL, a folder part), which
// the browser-side helpers of supertest would tidy up.

export interface Part {
  // The form field name.
  field: string;
  // The file name, written as it is (UTF-8) inside filename="...". Leave out
  // for a plain text field.
  filename?: string;
  contentType?: string;
  data: Buffer | string;
}

export function multipart(parts: Part[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----tessera-test-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.field}"`
        : `form-data; name="${part.field}"; filename="${part.filename}"`;
    let head = `--${boundary}\r\nContent-Disposition: ${disposition}\r\n`;
    if (part.filename !== undefined) {
      head += `Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n`;
    }
    chunks.push(
      Buffer.from(head + '\r\n'),
      Buffer.from(part.data),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// A few real file starts, for the image checks.
export const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000101a5f645400000000049454e44ae426082',
  'hex',
);
export const JPEG_BYTES = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffd9',
  'hex',
);
export const GIF_BYTES = Buffer.from(
  'GIF89a\x01\x00\x01\x00\x00\x00\x00;',
  'latin1',
);
export const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(14),
]);
export const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
export const HTML_BYTES = Buffer.from(
  '<!doctype html><script>alert(1)</script>',
);
