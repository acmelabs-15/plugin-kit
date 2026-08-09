/**
 * Deterministic extension-to-MIME mapping.
 *
 * DELIBERATE DIVERGENCE FROM THE ORIGINAL SCRIPT
 * ----------------------------------------------
 * The script this was ported from resolved extensions through the host's
 * system MIME registry. That registry is host-dependent: a bare interpreter
 * install carries 151 built-in entries, while a host that also has Apache's
 * `mime.types` on disk carries 1035. The same skill therefore rendered
 * differently on different machines -- an eval output could embed as
 * `image/webp` on one laptop and `application/octet-stream` on the next,
 * with no change to the skill, the workspace, or the outputs.
 *
 * This table is a fixed, in-repo mapping instead. Reproducibility across
 * machines is worth more here than parity with the original's host lookup,
 * because the entire job of the eval viewer is to show two people the same
 * thing. Anything not listed falls back to `application/octet-stream`, which
 * is exactly what the original returned whenever its own lookup missed.
 *
 * The four entries the original hard-coded as overrides ahead of its host
 * lookup -- svg, docx, xlsx, pptx -- carry identical values here, so those
 * types are byte-identical to the original on every host.
 */

/** Returned for any extension not present in the table. */
export const DEFAULT_MIME_TYPE = "application/octet-stream";

const MIME_TYPES: ReadonlyMap<string, string> = new Map([
  // Text and markup
  [".html", "text/html"],
  [".htm", "text/html"],
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".csv", "text/csv"],
  [".xml", "text/xml"],
  // Images
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  // Documents and archives
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".zip", "application/zip"],
]);

/**
 * Lowercased final extension of a path, including the leading dot, or `""`
 * when there is none.
 *
 * Matches the original's suffix semantics exactly: a dotfile with no other
 * dot has no extension (`.gitignore` -> `""`), a trailing dot is not an
 * extension (`archive.` -> `""`), and only the last component counts
 * (`bundle.tar.gz` -> `".gz"`).
 */
export function extensionOf(filePath: string): string {
  const separator = filePath.lastIndexOf("/");
  const name = separator < 0 ? filePath : filePath.slice(separator + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot).toLowerCase();
}

/** MIME type for a path, falling back to {@link DEFAULT_MIME_TYPE}. */
export function getMimeType(filePath: string): string {
  return MIME_TYPES.get(extensionOf(filePath)) ?? DEFAULT_MIME_TYPE;
}
