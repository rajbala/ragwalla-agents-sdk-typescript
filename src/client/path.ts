/**
 * Builds a request path from a template, encoding each interpolated value as one path segment.
 *
 * An id is caller data, and an application may take it from its own users. Interpolated raw, an
 * id such as `../organizations/org_1` or `x?y=1` would send the client's key to another route
 * (`new URL` resolves dot segments), so every value is encoded with `encodeURIComponent`, and a
 * value that would still be read as a dot segment, or is empty, is refused.
 */
export function path(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += segment(values[i]) + strings[i + 1];
  }
  return out;
}

function segment(value: string | number): string {
  const text = String(value);
  if (text === '' || text === '.' || text === '..') {
    throw new Error(`Invalid path segment: ${JSON.stringify(text)}`);
  }
  return encodeURIComponent(text);
}
