/**
 * Path arithmetic, mirrored from `../scripts/validate-skill.ts`.
 *
 * Deliberately duplicated rather than imported: this pass authors the schema
 * layer while `../scripts/**` is being rewritten, and the two copies are meant to
 * be reconciled by the later wiring pass, not now. Both are pure string maths --
 * no `node:path`, no disk.
 */

/** Resolve a possibly-relative path to an absolute, normalised one. */
export function resolvePath(p: string): string {
  const absolute = p.startsWith("/") ? p : `${process.cwd()}/${p}`;
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/** Final path segment, ignoring trailing slashes. */
export function baseName(p: string): string {
  const resolved = resolvePath(p);
  const index = resolved.lastIndexOf("/");
  return index === -1 ? resolved : resolved.slice(index + 1);
}
