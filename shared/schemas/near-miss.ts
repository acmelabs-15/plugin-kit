/**
 * Which legitimate key an unrecognized one was probably meant to be.
 *
 * A key typo in a data file is silent by construction: the reader looks the key up,
 * does not find it, and takes a default. Naming the nearest legitimate key is what
 * turns "this field did nothing" into "you wrote `expectatons`".
 *
 * Biased hard toward precision rather than recall, because the failure modes are not
 * symmetric. A missed suggestion still leaves an unknown-key finding naming the key,
 * which is enough to act on. A WRONG suggestion sends the author to rename a field
 * that was deliberate, and a suggester that guesses is one nobody reads twice. So a
 * key with no close match gets no suggestion at all, which is the common case for a
 * hand-added annotation.
 */

/**
 * Case and separator differences are collapsed BEFORE distance is measured, because
 * they are the single most common real typo in these files -- `shouldTrigger` for
 * `should_trigger` -- and plain edit distance scores that pair at 2, the same as two
 * unrelated substitutions.
 */
function normalize(key: string): string {
  return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

/** Levenshtein distance, two rows at a time rather than a full matrix. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return b.length;
  if (b === "") return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/**
 * How far apart two normalized keys may be and still be called the same mistake.
 *
 * Scaled by length because a fixed budget of 2 is generous on a short key and mean on
 * a long one: at 2, `id` would match `is`, `in` and `it`, none of which is a typo for
 * anything. Above four characters there is enough signal to afford two edits.
 */
function tolerance(shorter: number): number {
  return shorter <= 4 ? 1 : 2;
}

/**
 * The legitimate key `key` was most likely meant to be, or undefined when none is close.
 *
 * Ties break alphabetically so the message is the same on every run and in every
 * engine -- `Object.keys` order is not something a test should have to depend on.
 */
export function nearestKey(key: string, known: Iterable<string>): string | undefined {
  const target = normalize(key);
  let best: { readonly key: string; readonly distance: number } | undefined;

  for (const candidate of [...known].sort()) {
    const gap = distance(target, normalize(candidate));
    if (gap > tolerance(Math.min(target.length, normalize(candidate).length))) continue;
    if (best === undefined || gap < best.distance) best = { key: candidate, distance: gap };
  }
  return best?.key;
}

/**
 * The unknown-key finding, worded once so every schema that raises it agrees.
 *
 * The recognized set is listed when there is no suggestion, mirroring
 * `checkAllowedKeys` in `./skill-fields.ts`: an author who has just been told a key is
 * wrong and nothing else has to go and find the documentation.
 */
export function unknownKeyMessage(
  key: string,
  where: string,
  known: Iterable<string>,
): string {
  const suggestion = nearestKey(key, known);
  if (suggestion !== undefined) {
    return `Unknown key \`${key}\` in ${where}; did you mean \`${suggestion}\`? It was ignored.`;
  }
  const allowed = [...known].sort().join(", ");
  return `Unknown key \`${key}\` in ${where}; it was ignored. Recognized keys are: ${allowed}.`;
}

/** A record's unrecognized keys, sorted so a finding list is stable between runs. */
export function unknownKeysOf(
  row: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
): readonly string[] {
  return Object.keys(row)
    .filter((key) => !known.has(key))
    .sort();
}

/**
 * A parenthetical for the error raised when a required key is absent, naming the
 * unrecognized key that was probably meant to be it.
 *
 * In the ERROR rather than only in the companion warning, on purpose. The error is
 * what throws, and it is the line an operator reads out of a CI log where the two may
 * not be adjacent. "item 3 has no boolean should_trigger" sends someone hunting for a
 * key they are in fact looking straight at.
 */
export function misspellingHint(unknownKeys: readonly string[], required: string): string {
  const culprit = unknownKeys.find((key) => nearestKey(key, [required]) === required);
  return culprit === undefined ? "" : ` (the row carries \`${culprit}\`, which is not it)`;
}
