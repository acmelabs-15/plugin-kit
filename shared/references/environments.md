# Environments

The loop in SKILL.md is the same everywhere — draft, test, review, improve, repeat. What changes between environments is the machinery available to run it. Three branches.

This file is about where you *author* from. Where the finished artifact **runs** is a different question with more than three answers, including three separate tabs inside Claude Desktop — read `distribution-targets.md` instead if that is what you came for, because getting the two confused is how a skill authored in Cowork ends up assumed to run everywhere Cowork does.

---

## Claude Code — the full loop

Subagents, a browser, a display, and the `claude` CLI. Everything in SKILL.md works as written: parallel with-skill and baseline runs, grading subagents, the browser-based viewer, blind comparison, and description optimization.

Launch the slow jobs detached rather than waiting on them in a terminal — they write status files and start a dashboard showing every run's progress in one page. Read `running-detached.md` when one of them is running and you are deciding whether to wait, restart, or lower a timeout; the last of those is the one that quietly corrupts the result.

Nothing to adapt. The rest of this file is for the other two.

---

## Claude.ai — no subagents, no CLI, usually no display

**Running the evals.** With no subagents there is no parallel execution and no independent executor. For each eval, read the skill's SKILL.md and then follow its instructions to accomplish its prompt yourself, one at a time.

Be honest with the user about what this is worth: you wrote the skill and you are also running it, so you have full context an independent subagent would not. It is a useful sanity check rather than a measurement, and the human review step is what compensates. Skip the baseline runs — just use the skill to do the task.

**Reviewing results.** If there is no browser or display, skip the viewer entirely and present results directly in the conversation: for each eval, the prompt and the output. When the output is a file the user needs to see, save it to the filesystem and tell them where, so they can download and inspect it. Ask for feedback inline — "How does this look? Anything you'd change?"

**Benchmarking.** Skip it. The quantitative comparison depends on baselines, and baselines are not meaningful without independent runs. Focus on qualitative feedback.

**The iteration loop.** Unchanged in shape: improve, rerun the evals, ask for feedback. Just without the viewer in the middle. You can still organize results into iteration directories if you have a filesystem.

**Description optimization.** Requires `claude -p`, which is Claude Code only. Skip it, and with it the progress dashboard — there are no runs to report on.

**Blind comparison.** Requires subagents. Skip it.

**Packaging.** `../scripts/package-skill.ts` needs only Bun and a filesystem, so it works here and the user can download the resulting `.skill` file.

---

## Cowork — subagents, but no display

**The main workflow works.** You have subagents, so parallel eval runs, baselines and grading all run as written. If you hit severe timeout problems, running the evals in series is an acceptable fallback.

**The viewer needs `--static`.** With no browser or display, pass `--static <output_path>` to write a standalone HTML file instead of starting a server, then offer the user a link they can click to open it. The progress dashboard takes the same flag, and `SKILL_CREATOR_NO_OPEN=1` suppresses every window at once — the dashboard, the description report and the eval viewer — which is worth exporting for the whole session here rather than remembering a flag per command.

**Generate the viewer.** Something about this environment makes it tempting to skip the viewer and go straight to evaluating the outputs yourself. Do not. Whether you are in Cowork or Claude Code, once the runs are in you generate the eval viewer and get the outputs in front of the human *before* forming and acting on your own opinion — with `generate-review.ts`, not hand-written HTML. You wrote the skill; you will read its outputs generously, and the human is the correction for that. Put it on your todo list explicitly if you keep one: *"write evals.json and run `../eval-viewer/generate-review.ts` so the human can review the outputs."*

**Feedback arrives as a file.** With no running server, "Submit All Reviews" downloads `feedback.json`. Read it from there — you may need to request access first — and copy it into `evals/results/iteration-<N>/` so the next iteration picks it up.

**Packaging** works normally.

**Description optimization** works, since `optimize-description.ts` drives `claude -p` as a subprocess rather than needing a browser. Save it until the skill is finished and the user agrees it is in good shape — optimizing the description of a skill you are still rewriting wastes the run.

---

## Updating an existing skill

This applies in every environment, and comes up whenever the user's request is "improve this skill" rather than "make me a skill".

**Preserve the original name.** Note both the directory name and the `name` frontmatter field, and use them unchanged. If the installed skill is `research-helper`, the output is `research-helper.skill` — not `research-helper-v2`. A renamed skill is a new skill: it will not replace the installed one, and the user ends up with both.

**Copy to a writeable location before editing.** The installed skill path is often read-only. Copy it somewhere writeable, edit there, and package from the copy. If you are packaging by hand, stage in a temporary directory first and then copy to the output location — direct writes to the install path tend to fail on permissions.

**Snapshot before you edit, not after.** The baseline for an improvement run is the version the user arrived with, and once you have edited in place that version is gone. `cp -r <skill-path> evals/results/skill-snapshot/` before the first change.
