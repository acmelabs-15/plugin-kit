/**
 * Say at second zero whether an installed copy of the target will distort the sweep.
 *
 * Every measured operation needs the target either present or absent under its own name,
 * and the wrong state does not error — it floors a pull rate at zero (content served through
 * the skill system never produces a Read) or absorbs the triggers being measured (a copy
 * under the real name competes with the aliased one). It PRINTS rather than handing a line
 * back, so the loudness has one home and one test; the run that motivated it said nothing
 * and spent 144 runs.
 */
import { detectInstallState, installConflict, type InstallState, type OperationName } from "./envelope.ts";

export async function warnOnInstallConflict(params: {
  readonly skillPath: string;
  readonly skillName: string;
  /** Which operation is asking; decides what it needs and how the warning reads. */
  readonly operation?: OperationName;
  /** Where to sweep. Defaults to the process's directory, as every other call site does. */
  readonly projectDir?: string;
}): Promise<{ readonly state: InstallState; readonly conflict: string | null }> {
  const sighting = await detectInstallState({
    artifact: "skill",
    name: params.skillName,
    sourcePath: params.skillPath,
    projectDir: params.projectDir,
  });
  const conflict = installConflict({
    operation: params.operation ?? "measure-disclosure",
    needs: "absent",
    found: sighting.state,
  });
  if (conflict !== null) console.error(`\nWARNING: ${conflict}`);
  return { state: sighting.state, conflict };
}
