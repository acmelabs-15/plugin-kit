import { afterAll, describe, expect, test } from "bun:test";

import {
  FrontmatterError,
  parseFrontmatter,
  parseSkillMd,
  pyStrip,
  pyStripChars,
  skillMdPath,
} from "../lib/frontmatter.ts";

const TMP_ROOT = `${Bun.env.TMPDIR ?? "/tmp"}/skill-creator-frontmatter-${Bun.nanoseconds()}`;

afterAll(async () => {
  await Bun.$`rm -rf ${TMP_ROOT}`.quiet().nothrow();
});

/** Build a SKILL.md body from frontmatter lines. */
function fm(...lines: readonly string[]): string {
  return ["---", ...lines, "---", "", "# Body"].join("\n");
}

describe("quirk 1: opening delimiter uses .strip() semantics", () => {
  test("accepts a bare ---", () => {
    expect(parseFrontmatter(fm("name: a")).name).toBe("a");
  });

  test("accepts a padded '  ---  ' because .strip() runs first", () => {
    const content = ["  ---  ", "name: a", "---"].join("\n");
    expect(parseFrontmatter(content).name).toBe("a");
  });

  test("accepts a tab-padded delimiter", () => {
    const content = ["\t---\t", "name: a", "---"].join("\n");
    expect(parseFrontmatter(content).name).toBe("a");
  });

  test("throws when the opening --- is absent", () => {
    expect(() => parseFrontmatter("name: a\n---\n")).toThrow(FrontmatterError);
    expect(() => parseFrontmatter("name: a\n---\n")).toThrow(
      "SKILL.md missing frontmatter (no opening ---)",
    );
  });

  test("throws on empty input", () => {
    expect(() => parseFrontmatter("")).toThrow("no opening ---");
  });

  test("rejects a BOM-prefixed delimiter, because Python's strip() keeps U+FEFF", () => {
    expect(() => parseFrontmatter("﻿---\nname: a\n---\n")).toThrow("no opening ---");
  });

  test("---- is not a delimiter", () => {
    expect(() => parseFrontmatter("----\nname: a\n---\n")).toThrow("no opening ---");
  });
});

describe("quirk 2: closing delimiter is the first stripped match from line 1", () => {
  test("first match wins, so later keys fall outside the frontmatter", () => {
    const content = ["---", "name: inside", "---", "name: outside", "---"].join("\n");
    expect(parseFrontmatter(content).name).toBe("inside");
  });

  test("a padded closing delimiter still closes", () => {
    const content = ["---", "name: a", "  ---  "].join("\n");
    expect(parseFrontmatter(content).name).toBe("a");
  });

  test("throws when the closing --- is absent", () => {
    expect(() => parseFrontmatter("---\nname: a\n")).toThrow(
      "SKILL.md missing frontmatter (no closing ---)",
    );
  });

  test("an immediately-repeated --- yields empty frontmatter", () => {
    const parsed = parseFrontmatter("---\n---\n");
    expect(parsed.name).toBe("");
    expect(parsed.description).toBe("");
  });
});

describe("quirk 3: key matching is a raw-line prefix test", () => {
  test("an indented '  name:' MISSES", () => {
    expect(parseFrontmatter(fm("  name: indented")).name).toBe("");
  });

  test("a tab-indented '\\tname:' MISSES", () => {
    expect(parseFrontmatter(fm("\tname: tabbed")).name).toBe("");
  });

  test("'name : v' with a space before the colon MISSES", () => {
    expect(parseFrontmatter(fm("name : spaced")).name).toBe("");
  });

  test("'name:v' with no space after the colon MATCHES", () => {
    expect(parseFrontmatter(fm("name:nospace")).name).toBe("nospace");
  });

  test("'name_extra:' does NOT match, because the colon is part of the prefix", () => {
    expect(parseFrontmatter(fm("name_extra: x")).name).toBe("");
  });

  test("'namespace:' does NOT match", () => {
    expect(parseFrontmatter(fm("namespace: x")).name).toBe("");
  });

  test("'descriptionx:' does NOT match description", () => {
    expect(parseFrontmatter(fm("descriptionx: x")).description).toBe("");
  });

  test("absent keys default to empty strings", () => {
    const parsed = parseFrontmatter(fm("license: MIT"));
    expect(parsed.name).toBe("");
    expect(parsed.description).toBe("");
  });
});

describe("quirk 4: the loop never breaks, so the LAST occurrence wins", () => {
  test("last name wins", () => {
    expect(parseFrontmatter(fm("name: first", "name: second", "name: third")).name).toBe("third");
  });

  test("last description wins", () => {
    expect(parseFrontmatter(fm("description: one", "description: two")).description).toBe("two");
  });

  test("a later plain description overrides an earlier block scalar", () => {
    const parsed = parseFrontmatter(fm("description: |", "  block text", "description: plain"));
    expect(parsed.description).toBe("plain");
  });

  test("a later block scalar overrides an earlier plain description", () => {
    const parsed = parseFrontmatter(fm("description: plain", "description: |", "  block text"));
    expect(parsed.description).toBe("block text");
  });
});

describe("quirk 5: value cleaning is .strip().strip('\"').strip(\"'\")", () => {
  test('""double"" strips BOTH pairs of quotes', () => {
    expect(parseFrontmatter(fm('name: ""double""')).name).toBe("double");
  });

  test("''single'' strips BOTH pairs of quotes", () => {
    expect(parseFrontmatter(fm("name: ''single''")).name).toBe("single");
  });

  test("'\"mixed\"' keeps the inner double quotes, because ' is stripped last", () => {
    expect(parseFrontmatter(fm("name: '\"mixed\"'")).name).toBe('"mixed"');
  });

  test('"\'inverted\'" strips both, because " goes first then \'', () => {
    expect(parseFrontmatter(fm("name: \"'inverted'\"")).name).toBe("inverted");
  });

  test("a single balanced pair is stripped", () => {
    expect(parseFrontmatter(fm('name: "quoted"')).name).toBe("quoted");
  });

  test("an unbalanced leading quote is still stripped", () => {
    expect(parseFrontmatter(fm('name: "unbalanced')).name).toBe("unbalanced");
  });

  test("surrounding whitespace is stripped before quotes", () => {
    expect(parseFrontmatter(fm('name:   "padded"  ')).name).toBe("padded");
  });

  test("inner whitespace is preserved", () => {
    expect(parseFrontmatter(fm("name: two words")).name).toBe("two words");
  });

  test("the same cleaning applies to a plain description", () => {
    expect(parseFrontmatter(fm('description: ""double""')).description).toBe("double");
  });
});

describe("quirk 6: block scalars", () => {
  test.each([">", "|", ">-", "|-"])("%s is recognised as a block scalar", (header) => {
    const parsed = parseFrontmatter(fm(`description: ${header}`, "  first", "  second"));
    expect(parsed.description).toBe("first second");
  });

  test.each(["|+", ">+", "|2", ">2", "|-2", "||"])(
    "%s is NOT recognised, so it is read as a literal value",
    (header) => {
      const parsed = parseFrontmatter(fm(`description: ${header}`, "  first"));
      expect(parsed.description).toBe(header);
    },
  );

  test("literal | still loses newlines, because lines join with a single space", () => {
    const parsed = parseFrontmatter(fm("description: |", "  line one", "  line two"));
    expect(parsed.description).toBe("line one line two");
    expect(parsed.description).not.toContain("\n");
  });

  test("continuation lines are individually stripped", () => {
    const parsed = parseFrontmatter(fm("description: >", "    deeply indented   ", "  next"));
    expect(parsed.description).toBe("deeply indented next");
  });

  test("a tab-indented continuation line is collected", () => {
    const parsed = parseFrontmatter(fm("description: |", "\ttabbed", "\tsecond"));
    expect(parsed.description).toBe("tabbed second");
  });

  test("a single-space line terminates the block", () => {
    const parsed = parseFrontmatter(fm("description: |", "  kept", " dropped"));
    expect(parsed.description).toBe("kept");
  });

  test("an empty line terminates the block", () => {
    const parsed = parseFrontmatter(fm("description: |", "  kept", "", "  unreachable"));
    expect(parsed.description).toBe("kept");
  });

  test("a non-indented line terminates the block", () => {
    const parsed = parseFrontmatter(fm("description: |", "  kept", "name: after"));
    expect(parsed.description).toBe("kept");
  });

  test("parsing resumes at the terminating line, so a following key is still read", () => {
    const parsed = parseFrontmatter(fm("description: |", "  text", "name: after"));
    expect(parsed.name).toBe("after");
    expect(parsed.description).toBe("text");
  });

  test("a block scalar with no continuation lines yields an empty description", () => {
    expect(parseFrontmatter(fm("description: >", "name: a")).description).toBe("");
  });

  test("a block scalar at the end of frontmatter yields an empty description", () => {
    expect(parseFrontmatter(fm("description: |")).description).toBe("");
  });

  test("continuation lines are NOT quote-stripped", () => {
    const parsed = parseFrontmatter(fm("description: >", '  "quoted"'));
    expect(parsed.description).toBe('"quoted"');
  });

  test("name: does not support block scalars", () => {
    expect(parseFrontmatter(fm("name: |", "  ignored")).name).toBe("|");
  });
});

describe("quirk 7: content is the entire file, frontmatter included", () => {
  test("returns the input verbatim", () => {
    const content = fm("name: a", "description: b");
    const parsed = parseFrontmatter(content);
    expect(parsed.content).toBe(content);
    expect(parsed.content.startsWith("---")).toBe(true);
    expect(parsed.content).toContain("# Body");
  });

  test("trailing body content is untouched by parsing", () => {
    const content = "---\nname: a\n---\nbody\n---\nmore\n";
    expect(parseFrontmatter(content).content).toBe(content);
  });
});

describe("pyStrip / pyStripChars", () => {
  test("strips the ASCII whitespace JS also strips", () => {
    expect(pyStrip(" \t\r\n\fx \t\r\n\f")).toBe("x");
  });

  test("strips U+001C-U+001F and U+0085, which JS .trim() does not", () => {
    for (const ch of ["", "", "", "", ""]) {
      expect(pyStrip(`${ch}x${ch}`)).toBe("x");
      expect(`${ch}x${ch}`.trim()).not.toBe("x");
    }
  });

  test("does NOT strip U+FEFF, which JS .trim() does", () => {
    expect(pyStrip("﻿x﻿")).toBe("﻿x﻿");
    expect("﻿x﻿".trim()).toBe("x");
  });

  test("does not strip U+200B zero-width space", () => {
    expect(pyStrip("​x")).toBe("​x");
  });

  test("strips Unicode spaces Python considers whitespace", () => {
    expect(pyStrip("  　x ")).toBe("x");
  });

  test("removes repeated characters, unlike a single regex replace", () => {
    expect(pyStripChars('""""x""""', '"')).toBe("x");
  });

  test("leaves interior characters alone", () => {
    expect(pyStripChars('"a"b"', '"')).toBe("a\"b");
  });

  test("an all-strippable string collapses to empty", () => {
    expect(pyStripChars('""""', '"')).toBe("");
    expect(pyStrip("   ")).toBe("");
  });
});

describe("skillMdPath", () => {
  test.each([
    ["skills/demo", "skills/demo/SKILL.md"],
    ["skills/demo/", "skills/demo/SKILL.md"],
    ["/abs/demo", "/abs/demo/SKILL.md"],
    ["", "SKILL.md"],
  ])("%s -> %s", (input, expected) => {
    expect(skillMdPath(input)).toBe(expected);
  });
});

describe("parseSkillMd reads from disk", () => {
  test("parses a real SKILL.md", async () => {
    const dir = `${TMP_ROOT}/demo`;
    const content = fm("name: demo", "description: A demo skill.");
    await Bun.write(`${dir}/SKILL.md`, content);

    const parsed = await parseSkillMd(dir);
    expect(parsed.name).toBe("demo");
    expect(parsed.description).toBe("A demo skill.");
    expect(parsed.content).toBe(content);
  });

  test("a trailing slash on the directory is tolerated", async () => {
    const dir = `${TMP_ROOT}/slash`;
    await Bun.write(`${dir}/SKILL.md`, fm("name: slash"));
    expect((await parseSkillMd(`${dir}/`)).name).toBe("slash");
  });

  test("rejects a missing file, as CPython's read_text does", async () => {
    await expect(parseSkillMd(`${TMP_ROOT}/absent`)).rejects.toThrow();
  });

  test("propagates FrontmatterError for a malformed file", async () => {
    const dir = `${TMP_ROOT}/broken`;
    await Bun.write(`${dir}/SKILL.md`, "no frontmatter\n");
    await expect(parseSkillMd(dir)).rejects.toThrow(FrontmatterError);
  });
});
