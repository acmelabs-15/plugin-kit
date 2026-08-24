/**
 * The HTML report for the progressive-disclosure optimizer.
 *
 * Same visual system as the rest of the repository, and deliberately not a second one:
 * the tokens, the component layer and the pre-paint theme script all come from
 * `./theme.ts`, so a colour changed there changes here too. What this module
 * adds is three small rules for the pull-rate bars, and nothing else -- every heading,
 * table, metric tile and callout below is the shared `.sec` / `.metric` / `.tbl` /
 * `.note` vocabulary the dashboard and the description report already use.
 *
 * `DESIGN_OVERRIDES` is included, which `generate-report.ts` does not do. Its table rule
 * exists because our cells hold wrapped prose rather than short figures, and this
 * report's widest column is a rationale sentence -- exactly the case the override was
 * derived from.
 *
 * The trend is drawn with divs rather than a chart library. Nothing in this repository
 * ships one, the report has to open from a `file://` path with no network, and a
 * proportional bar built from `.progress-track` / `.progress-fill` -- which the
 * description report already uses -- says everything a two-series line chart would about
 * four iterations.
 */

import {
  DESIGN_COMPONENTS,
  DESIGN_OVERRIDES,
  THEME_PREPAINT_SCRIPT,
  THEME_TOKENS,
} from "./theme.ts";
import { formatPercent, htmlEscape } from "../util/pyfloat.ts";
import { NO_GROUND_TRUTH } from "../operations/disclosure.ts";
import type {
  FileRecall,
  FileStat,
  FileVerdict,
  GroundTruth,
  SplitScore,
  TokenMethod,
} from "../operations/disclosure.ts";

/** One iteration's row: what was tried, what it cost, and whether it survived. */
export interface IterationRecord {
  readonly iteration: number;
  /** "baseline", or the candidate's one-line summary. */
  readonly label: string;
  readonly candidateId: string | null;
  readonly rationale: string;
  readonly bodyTokens: number;
  readonly train: SplitScore;
  readonly holdout: SplitScore | null;
  /** Whether this layout became the one the next iteration builds on. */
  readonly accepted: boolean;
  /** The selection or rejection reason, verbatim from `selectCandidate`. */
  readonly note: string;
}

/**
 * A condition a reader has to know about before believing anything under it.
 *
 * The two severities are not degrees of one thing. `qualifying` says the figures rest on less
 * evidence than the run count suggests, and the response is to discount them. `invalidating`
 * says the run did not measure what it set out to, and the response is to discard it — a
 * disclosure sweep that reached an installed copy of the skill scores every bundled file at a
 * pull rate of zero, because content served through the skill system never produces a `Read`,
 * so its confident column of `prune` verdicts is output rather than evidence. Rendering both
 * at one severity would leave the reader to work out which they were holding.
 */
export interface DisclosureWarning {
  readonly severity: "invalidating" | "qualifying";
  readonly text: string;
}

/** A phase in flight, so a live report is distinguishable from a hung one. */
export interface DisclosureProgress {
  readonly iteration: number;
  readonly settled: number;
  readonly total: number;
  readonly phase: string;
  readonly startedAt?: number;
  readonly remainingMs?: number;
}

export interface DisclosureReportInput {
  readonly skillName: string;
  readonly skillPath: string;
  readonly tokenMethod: TokenMethod;
  readonly estimatedTokens: boolean;
  readonly baselineBodyTokens: number;
  readonly bestBodyTokens: number;
  readonly baselineContextTokens: number;
  readonly bestContextTokens: number;
  readonly holdoutFraction: number;
  readonly trainSize: number;
  readonly holdoutSize: number;
  readonly runsPerScenario: number;
  /** The file table, from the most recent measurement of the current layout. */
  readonly files: readonly FileStat[];
  /**
   * What ground truth the scenario set declared, and what its negative rows measured.
   *
   * Optional so a caller mid-run, or one that predates recall, still renders: absent is
   * treated as "none declared", which is the same thing the figures would show anyway.
   */
  readonly groundTruth?: GroundTruth | undefined;
  readonly iterations: readonly IterationRecord[];
  readonly exitReason: string;
  /** Where the winning layout was written, when one was. */
  readonly appliedTo: string | null;
  /**
   * What the rewriter did that an author should look at before adopting the result.
   *
   * Shown on the page rather than only in `results.json`, because these are the things a
   * deterministic rewrite cannot get right on its own -- a pointer sentence that named
   * two files and now names one that is gone, say. Someone reading the report is
   * precisely the person about to adopt the layout.
   */
  readonly notes?: readonly string[];
  /**
   * Conditions that change how the whole page should be read, rendered above the figures.
   *
   * Above rather than beside or below, and that placement is the point. The failure this
   * exists for produces a report that looks fine — every pull rate zero, every verdict
   * `prune`, nothing on the page admitting the run was answered by an installed copy instead
   * of the layout under test. A reader must not be able to reach that table without passing
   * the sentence saying it means nothing.
   *
   * A caller passes only what it alone knows, which in practice is the install conflict. The
   * conditions visible in the split score are derived here instead — see the derivation in
   * {@link generateDisclosureReport}.
   */
  readonly warnings?: readonly DisclosureWarning[];
  readonly inProgress?: DisclosureProgress;
}

export interface DisclosureReportOptions {
  /** Adds a meta refresh, for the copy rewritten between iterations. Default false. */
  readonly autoRefresh?: boolean;
  /** Injected so elapsed readings are deterministic under test. */
  readonly now?: number;
}

/**
 * The only bespoke CSS in this report.
 *
 * Five rules, each earning its place: a bar built from the shared surface tokens, a
 * verdict pill that reuses `.chip` and only recolours it, a right-aligned numeric
 * cell the shared `.tbl` does not define for this column count, one tone for a warning
 * severe enough to void the page, and the gap between the ground-truth tiles and the file
 * table they introduce — the shared grids carry no bottom margin, which is the same reason
 * `.g4 + .note` exists below.
 *
 * Only the fatal tone is local. A qualifying warning uses the shared `.note.warn`, whose
 * treatment is what a local rule would have duplicated exactly — and a byte-identical copy of
 * a shared component is how the two stop agreeing the first time either is retuned. The theme
 * has no `--bad` variant of `.note`, so the fatal tone has nowhere else to live.
 */
const REPORT_CSS = `
  .wrap{ max-width:1080px; }
  section.sec:first-of-type{ border-top:0; padding-top:28px; }
  .bar{ position:relative; height:9px; border-radius:999px; background:var(--surface-3);
    border:1px solid var(--border); overflow:hidden; min-width:96px; }
  .bar > span{ display:block; height:100%; background:var(--accent); }
  .bar.good > span{ background:var(--good); }
  .bar.warn > span{ background:var(--warn); }
  .bar.bad > span{ background:var(--bad); }
  .barcell{ display:flex; align-items:center; gap:10px; }
  .barcell .num{ font-family:var(--mono); font-size:11.5px; color:var(--muted); flex:0 0 62px; text-align:right; }
  .v-inline{ color:var(--accent); } .v-prune{ color:var(--bad); } .v-signpost{ color:var(--warn); }
  .v-misfiled{ color:var(--warn); } .v-keep{ color:var(--faint); }
  tr.rejected td{ opacity:.62; }
  tr.accepted td:first-child{ box-shadow:inset 2px 0 0 var(--good); }
  .why{ color:var(--muted); font-size:12px; line-height:1.55; }
  .note.invalidated{ border-left-color:var(--bad); } .note.invalidated .nb{ color:var(--bad); }
  /* The metric row and the note explaining it are separate thoughts, and the shared .g4
     grid carries no bottom margin, so they render flush. 18px is slightly wider than the
     14px inter-card gap, so the note reads as following the row rather than as a fifth
     card in it. */
  .g4 + .note{ margin-top:18px; }
  .g2 + .panel{ margin-top:18px; }
`;

function bar(fraction: number, tone: "" | "good" | "warn" | "bad" = ""): string {
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return `<div class="bar ${tone}"><span style="width:${percent}%"></span></div>`;
}

/** Whole seconds as `1m 40s`. Approximate by nature, so no decimals -- as elsewhere. */
function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.trunc(totalSeconds / 60);
  return minutes > 0 ? `${minutes}m ${totalSeconds % 60}s` : `${totalSeconds}s`;
}

/** What each verdict means, in one clause, so the table needs no key elsewhere. */
const VERDICT_GLOSS: Readonly<Record<FileVerdict, string>> = {
  inline: "pulled on nearly every run — body content arriving late",
  prune: "signposted and never pulled — test whether deleting it changes anything",
  signpost: "nothing in the body points here, so it could never load",
  misfiled: "read, but it lives in a directory whose files are run or copied",
  keep: "conditional content, which is what deferral is for",
};

/**
 * The recall cell: a rate over its own denominator, or a stated absence.
 *
 * The denominator is rendered rather than implied, because it is not the pull rate's. A
 * reference three scenarios need is judged against three scenarios' runs, and "67%" beside
 * a pull rate over ninety runs invites a reader to compare two fractions that share no
 * denominator. The numbers here are small enough that the pair matters more than the ratio.
 *
 * A file no scenario named says so in words. A dash reads as a measurement that came back
 * empty, which is the confusion between "not declared" and "never followed" that the whole
 * absent-versus-empty distinction exists to prevent.
 */
function recallCell(recall: FileRecall | null | undefined): string {
  if (recall === null || recall === undefined) {
    return '<span class="faint">not declared</span>';
  }
  const tone = recall.rate >= 0.8 ? "good" : recall.rate >= 0.5 ? "warn" : "bad";
  return `<div class="barcell">${bar(recall.rate, tone)}<span class="num">${recall.reads}/${recall.expectedRuns}</span></div>`;
}

function fileRow(file: FileStat): string {
  const tone = file.verdict === "keep" ? "" : file.verdict === "inline" ? "good" : "warn";
  return `            <tr>
              <td><code>${htmlEscape(file.path)}</code></td>
              <td class="muted">${htmlEscape(file.loadMode)}</td>
              <td class="n">${file.tokens}</td>
              <td><div class="barcell">${bar(file.pullRate, tone)}<span class="num">${file.pulls}/${file.countedRuns}</span></div></td>
              <td>${recallCell(file.recall)}</td>
              <td>${file.signposted ? "yes" : '<span class="faint">no</span>'}</td>
              <td><span class="chip v-${file.verdict}">${file.verdict}</span></td>
              <td class="why">${htmlEscape(VERDICT_GLOSS[file.verdict])}</td>
            </tr>
`;
}

/**
 * The sentence under the file table explaining what the recall column is measured against.
 *
 * Three states, and each needs different words. A set that declares nothing has to be told
 * so, or a column of "not declared" reads as a broken measurement. A set with positives but
 * no negatives has a real recall and a missing counterweight, which is the state that
 * flatters a layout pulling everything. Only the third has both.
 */
/**
 * The two ground-truth tiles above the file table, or nothing when none was declared.
 *
 * Beside the recall column rather than in the headline row at the top of the page, because
 * these two figures answer questions about that table specifically -- what the recall
 * column was measured against, and what the negative rows found -- and a reader meets them
 * at the moment they need them rather than four sections earlier.
 *
 * Both tiles lead with a count, not a rate. Over-fetch shows `2/6` in its footer for the
 * same reason recall does in its cell: these denominators are small, and a percentage on
 * its own hides how thin the evidence under it is.
 */
function groundTruthTiles(truth: GroundTruth): string {
  if (truth.annotatedScenarios === 0) return "";
  const overFetch = truth.overFetch;
  return `    <div class="g2">
      <div class="metric">
        <div class="ml">ground truth declared</div>
        <div class="mv">${truth.annotatedScenarios}</div>
        <div class="mf">scenario(s) declaring what they should reach, across ${truth.annotatedRuns} run(s) — the denominator behind the recall column</div>
      </div>
      <div class="metric">
        <div class="ml">over-fetch</div>
        <div class="mv">${overFetch === null ? "—" : formatPercent(overFetch.rate, 0)}</div>
        <div class="mf">${
          overFetch === null
            ? "no scenario declares the empty list, so nothing checks a layout that pulls everything"
            : `${overFetch.runsThatRead}/${overFetch.runs} run(s) of the ${overFetch.scenarios} scenario(s) that should have reached nothing read a bundled file`
        }</div>
      </div>
    </div>
`;
}

function recallNote(truth: GroundTruth): string {
  if (truth.annotatedScenarios === 0) {
    return `No scenario declares <code>expects_references</code>, so there is no ground truth
    and no recall to report. The pull rates above say how often each file was read, never how
    often it was read <em>when it was needed</em> — a reference only three scenarios need
    shows a low rate however good its pointer is, which looks identical in the data to a
    pointer nobody follows.`;
  }
  const denominators = `Recall is counted over the runs of the ${truth.annotatedScenarios}
    scenario(s) that declared what they should reach — a different, and much smaller,
    denominator from the pull rate beside it, which is why both fractions are shown.`;
  if (truth.overFetch === null) {
    return `${denominators} None of them declares the EMPTY list, so over-fetch is not
    measured: recall alone is maximized by a layout that pulls every file on every run, and
    a scenario expecting to reach nothing is what catches that.`;
  }
  return `${denominators} Over-fetch is the counterweight, measured over the
    ${truth.overFetch.scenarios} scenario(s) that should have reached nothing at all.`;
}

function splitCell(score: SplitScore | null): string {
  if (score === null) return '<span class="faint">—</span>';
  return `${formatPercent(score.passRate, 0)} <span class="faint">(${score.assertionsPassed}/${score.assertionsTotal})</span>`;
}

function iterationRow(record: IterationRecord, maxBodyTokens: number): string {
  const holdout = record.holdout;
  // Neutral rather than green when there is no held-out score. A missing measurement is
  // the common case now that a candidate losing on train is retired before its held-out
  // runs are spent, and an empty bar tinted "good" reads as a pass that was never scored.
  const passTone =
    holdout === null ? "" : holdout.passRate >= 0.9 ? "good" : holdout.passRate >= 0.7 ? "warn" : "bad";
  const share = maxBodyTokens === 0 ? 0 : record.bodyTokens / maxBodyTokens;
  return `            <tr class="${record.accepted ? "accepted" : "rejected"}">
              <td class="n">${record.iteration}</td>
              <td>${htmlEscape(record.label)}<div class="why">${htmlEscape(record.rationale)}</div></td>
              <td><div class="barcell">${bar(share)}<span class="num">${record.bodyTokens}</span></div></td>
              <td class="n">${Math.round((record.holdout ?? record.train).meanContextTokens)}</td>
              <td>${splitCell(record.train)}</td>
              <td><div class="barcell">${bar(holdout === null ? 0 : holdout.passRate, passTone)}<span class="num">${splitCell(holdout)}</span></div></td>
              <td class="why">${record.accepted ? "kept" : "rejected"} — ${htmlEscape(record.note)}</td>
            </tr>
`;
}

/**
 * The warning callout, rendered before the metric tiles and therefore before everything.
 *
 * One block rather than one per warning, taking the tone of the worst of them: a page with two
 * callouts invites a reader to read the first and skip the second, and the whole reason this is
 * at the top is that the thing it has to say is easy to miss.
 *
 * Each row leads with what to DO about it, in words that stand alone. "Discard" and "discount"
 * are the difference between a run that measured the wrong thing and a run that measured the
 * right thing thinly, and a reader should not have to open the source to tell which they have.
 */
function warningBlock(warnings: readonly DisclosureWarning[]): string {
  if (warnings.length === 0) return "";
  const invalidated = warnings.some((warning) => warning.severity === "invalidating");
  const rows = warnings
    .map((warning) => {
      const lead =
        warning.severity === "invalidating"
          ? "Invalidates this run — discard the figures below."
          : "Qualifies these figures — discount them.";
      return `\n        <li><b>${lead}</b> ${htmlEscape(warning.text)}</li>`;
    })
    .join("");
  const headline = invalidated
    ? "this run did not measure what it set out to"
    : "read these figures with care";
  const summary = invalidated
    ? `At least one condition below invalidated the measurement. Every figure and verdict on
      this page is output rather than evidence — a layout change justified by them would be
      fixing a problem this run is not in a position to have found.`
    : `Nothing invalidated the measurement, but the conditions below mean parts of it rest on
      less evidence than the numbers suggest.`;
  return `    <div class="note ${invalidated ? "invalidated" : "warn"}">
      <div class="nb">${headline}</div>
      <div>${summary}</div>
      <ul class="why">${rows}
      </ul>
    </div>

`;
}

function progressRow(progress: DisclosureProgress, now: number): string {
  const percent = progress.total > 0 ? progress.settled / progress.total : 0;
  const meta = [`<b>${htmlEscape(progress.phase)}</b>`];
  if (progress.total > 0) meta.push(`${progress.settled}/${progress.total} runs`);
  if (progress.startedAt !== undefined) meta.push(`${formatDuration(now - progress.startedAt)} elapsed`);
  // Approximate, and said to be: it is extrapolated from observed completions, and a
  // scenario run is long enough that the spread between the fastest and slowest is wide.
  if (progress.remainingMs !== undefined) meta.push(`~${formatDuration(progress.remainingMs)} left`);
  return `            <tr>
              <td class="n">${progress.iteration}</td>
              <td colspan="6">
                <div class="barcell">${bar(percent)}<span class="num">${Math.round(percent * 100)}%</span></div>
                <div class="why" style="margin-top:6px">${meta.join(" · ")}</div>
              </td>
            </tr>
`;
}

/**
 * Render the report.
 *
 * Written to be safe on a partial input, the way `generate-report.ts` is: the loop
 * rewrites this file after every measurement, long before any verdict exists, so an
 * empty `iterations` array and a null `appliedTo` are ordinary states rather than
 * errors.
 */
export function generateDisclosureReport(
  input: DisclosureReportInput,
  options: DisclosureReportOptions = {},
): string {
  const { autoRefresh = false, now = Date.now() } = options;
  const title = `${input.skillName} — progressive disclosure`;
  const maxBodyTokens = Math.max(
    input.baselineBodyTokens,
    ...input.iterations.map((record) => record.bodyTokens),
    1,
  );
  const bodySaved = input.baselineBodyTokens - input.bestBodyTokens;
  const contextSaved = input.baselineContextTokens - input.bestContextTokens;
  const latest = input.iterations[input.iterations.length - 1];
  const guardScore = latest === undefined ? null : (latest.holdout ?? latest.train);
  // Absent is rendered as "none declared" rather than refused. This page is rewritten
  // after every measurement, long before a caller has ground truth to hand it, and a
  // report that throws mid-run is worse than one that says nothing was declared yet.
  const truth = input.groundTruth ?? NO_GROUND_TRUTH;

  // Derived here rather than asked of the caller. Both producers would have to read these off
  // the same `SplitScore` the tiles below are computed from, so deriving once is what stops the
  // two of them disagreeing — and it spares each from reproducing the walk that decides which
  // iteration the page is describing. A caller passes only what it alone can know.
  const derived: DisclosureWarning[] = [];
  if (guardScore !== null && guardScore.runsWithoutSkill > 0) {
    derived.push({
      severity: "qualifying",
      text:
        `${guardScore.runsWithoutSkill} run(s) completed without the skill body ever reaching ` +
        `context, so they are dropped from every pull rate below and the verdicts rest on ` +
        `fewer runs than the run count implies.`,
    });
  }
  if (guardScore !== null && guardScore.assertionsTotal === 0) {
    derived.push({
      severity: "qualifying",
      text:
        `No scenario carried expectations, so the pass rate is measured against nothing and ` +
        `says only that the runs completed. Nothing on this page checks that the skill still ` +
        `works.`,
    });
  }
  const warnings = [...(input.warnings ?? []), ...derived];

  // Said in the report rather than only in the terminal. A body measured at 4,800
  // estimated tokens against a 5,000-token budget has not been shown to be inside it,
  // and a reader who does not know which number they are looking at cannot tell.
  const tokenNote = input.estimatedTokens
    ? `Token figures are ESTIMATES from the characters-over-four rule of thumb — <code>tiktoken</code> was not available, so every token count on this page can be out by a wide margin on dense tables and code.`
    : `Token figures come from <code>${htmlEscape(input.tokenMethod)}</code>, a real tokenizer, so the body budget can be read literally.`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${THEME_PREPAINT_SCRIPT}
${autoRefresh ? '<meta http-equiv="refresh" content="5">\n' : ""}<title>${htmlEscape(title)}</title>
<style>
${THEME_TOKENS}
${DESIGN_COMPONENTS}
${DESIGN_OVERRIDES}
${REPORT_CSS}
</style>
</head>
<body>
<div class="wrap">
  <section class="sec">
    <div class="sec-head">
      <div>
        <div class="eyebrow">outcome</div>
        <h2>${htmlEscape(input.skillName)} — progressive disclosure</h2>
      </div>
      <p class="desc">What this skill costs to invoke, and what moving content between the
      body and the bundled files did to that cost. The layout is selected on the held-out
      scenarios, and a restructure that cuts tokens while breaking the work is a regression
      rather than an optimization.</p>
    </div>

${warningBlock(warnings)}    <div class="g4">
      <div class="metric">
        <div class="ml">body tokens</div>
        <div class="mv">${input.bestBodyTokens}</div>
        <div class="mf">${bodySaved === 0 ? "unchanged from the baseline" : bodySaved > 0 ? `${bodySaved} fewer than the baseline's ${input.baselineBodyTokens}` : `${-bodySaved} more than the baseline's ${input.baselineBodyTokens}`}, paid on every invocation</div>
      </div>
      <div class="metric">
        <div class="ml">context per run</div>
        <div class="mv">${Math.round(input.bestContextTokens)}</div>
        <div class="mf">${contextSaved === 0 ? "unchanged" : contextSaved > 0 ? `${Math.round(contextSaved)} fewer` : `${Math.round(-contextSaved)} more`} than the baseline, mean across held-out runs</div>
      </div>
      <div class="metric">
        <div class="ml">pass rate</div>
        <div class="mv">${guardScore === null ? "—" : formatPercent(guardScore.passRate, 0)}</div>
        <div class="mf">the guardrail — assertions still passing after the restructure</div>
      </div>
      <div class="metric">
        <div class="ml">split</div>
        <div class="mv">${input.trainSize}/${input.holdoutSize}</div>
        <div class="mf">train / held-out scenarios, ${input.runsPerScenario} run(s) each</div>
      </div>
    </div>

    <div class="note">
      <div class="nb">how to read this</div>
      <div>${tokenNote}</div>${
        guardScore === null || guardScore.runsWithoutSkill === 0
          ? ""
          : `\n      <div><b>${guardScore.runsWithoutSkill} run(s) never loaded the skill.</b> Every pull rate below is
      conditional on the body having reached context, so those runs are excluded from the
      denominators — the verdicts rest on less evidence than the run count suggests.</div>`
      }
      <div>A reference pulled on nearly every run is body content paying an extra tool call
      to arrive late. A bundled file pulled on no run is either dead weight or invisible,
      and the <b>signposted</b> column is what separates those two — a file the body never
      names could not have loaded, so its zero says nothing about its value yet.</div>
      <div>Exit: ${htmlEscape(input.exitReason)}${input.appliedTo === null ? "" : `. The selected layout was written to <code>${htmlEscape(input.appliedTo)}</code>.`}</div>
    </div>
${
  (input.notes ?? []).length === 0
    ? ""
    : `    <div class="note">
      <div class="nb">before adopting this layout</div>
      <div>The rewrite is deterministic, and these are the places it could not decide for
      itself.</div>
      <ul class="why">${(input.notes ?? []).map((note) => `\n        <li>${htmlEscape(note)}</li>`).join("")}
      </ul>
    </div>
`
}  </section>

  <section class="sec">
    <div class="sec-head">
      <div>
        <div class="eyebrow">per file</div>
        <h2>What actually got read</h2>
      </div>
      <p class="desc">Every bundled file, and the fraction of runs that read it. Files under
      <code>scripts/</code> and <code>assets/</code> are run and copied rather than read, so
      a zero there is the correct outcome and is scored as such.</p>
    </div>
${groundTruthTiles(truth)}    <div class="panel pad0">
      <table class="tbl">
        <thead>
          <tr>
            <th>File</th><th>Load mode</th><th class="n">Tokens</th><th>Pull rate</th>
            <th>Recall</th><th>Signposted</th><th>Verdict</th><th>Why</th>
          </tr>
        </thead>
        <tbody>
${input.files.length === 0 ? '            <tr><td colspan="8" class="faint">No bundled files.</td></tr>\n' : input.files.map(fileRow).join("")}        </tbody>
      </table>
    </div>
    <p class="fine">A pull is a <code>Read</code> whose path lands inside the skill directory.
    A file opened some other way — piped through a shell command, say — is invisible to this
    measurement and will read as never pulled.</p>
    <p class="fine">${recallNote(truth)}</p>
  </section>

  <section class="sec">
    <div class="sec-head">
      <div>
        <div class="eyebrow">per iteration</div>
        <h2>Body tokens against the guardrail</h2>
      </div>
      <p class="desc">One row per layout measured. The body-token bar is the unconditional
      bill; the pass-rate bar beside it is what stops the loop buying a smaller bill with a
      broken skill. Selection reads the held-out column only.</p>
    </div>
    <div class="panel pad0">
      <table class="tbl">
        <thead>
          <tr>
            <th class="n">#</th><th>Layout</th><th>Body tokens</th><th class="n">Context/run</th>
            <th>Train pass</th><th>Held-out pass</th><th>Outcome</th>
          </tr>
        </thead>
        <tbody>
${input.iterations.map((record) => iterationRow(record, maxBodyTokens)).join("")}${input.inProgress === undefined ? "" : progressRow(input.inProgress, now)}        </tbody>
      </table>
    </div>
    <p class="fine">A candidate is kept only when its held-out pass rate holds within
    tolerance of the baseline <em>and</em> its context cost does not rise. Everything else is
    shown greyed with the reason it lost, because a rejected restructure is a measurement
    too — it says the content it moved was being used.</p>
  </section>
</div>
</body>
</html>
`;
}
