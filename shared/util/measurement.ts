/**
 * The two knobs every measured loop used to expose and none should: which model answers
 * the probes, and how many run at once. One home, because the disclosure and triggering
 * loops import each other's modules in a cycle and each has to read the same answer.
 *
 * A default is still a knob. These are the tool's own decisions — a run that inherits
 * whatever model or parallelism the operator happens to have varies by operator without
 * saying so, and the envelope's comparability key then lies. `--model` and `--num-workers`
 * remain as deliberate overrides, and the envelope records what actually ran.
 */
import { availableParallelism } from "node:os";

/**
 * The model every measurement sweeps on unless a tier study says otherwise.
 *
 * The weaker tier IS THE DETECTION INSTRUMENT. A disclosure measurement asks whether the
 * body's pointers send a model to the right file at the right moment, and a triggering
 * measurement asks whether the description sends the router to the skill; a stronger tier
 * answers both correctly in spite of a defect — it infers what was meant — and reports
 * health for a signposting or description defect that is still there when a weaker tier
 * meets it. See `disclosure-optimization.md` and `description-writing.md`.
 */
export const MEASUREMENT_MODEL = "sonnet";

/**
 * Concurrent `claude -p` children per sweep: twice the core count, floored so a small
 * machine still overlaps its waiting, capped at the highest value measured good (24; a
 * 48-worker run on a 10-core box ran slower than 24, not faster). A child is
 * network-bound, so the ceiling is the API and the machine, not the CPU.
 */
export const DEFAULT_NUM_WORKERS = Math.max(4, Math.min(24, availableParallelism() * 2));
