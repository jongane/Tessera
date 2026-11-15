// The Content-Disposition header of a download: "attachment", the name as
// plain ASCII for old browsers (anything that could end the quoted text or
// the header is replaced), and the full name as filename*=UTF-8''... so
// names in any language survive. A name can never add to or break the header.
export function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\;%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
