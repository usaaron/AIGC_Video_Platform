import { apiRequest } from "@/lib/api-client";
import type {
  MasterScriptFinalizationResult,
  ScriptGenerationRun,
  ScriptRevisionRun,
} from "@/lib/types";

interface RevisionResponse { data: ScriptRevisionRun }
interface FinalizationResponse { data: MasterScriptFinalizationResult }

export interface QualityLoopResult {
  revisionRun: ScriptRevisionRun;
  finalizationResult: MasterScriptFinalizationResult;
}

export async function completeScriptQualityLoop(
  generationRun: ScriptGenerationRun,
): Promise<QualityLoopResult> {
  const revisionResponse = await apiRequest<RevisionResponse>(
    "/script-generation/revise-draft",
    {
      method: "POST",
      body: JSON.stringify({
        draft_master_script: generationRun.draft_master_script,
        revision_plan: generationRun.revision_plan,
      }),
    },
  );
  const speakerNames = Array.from(new Set(
    generationRun.draft_master_script.characters
      .map((character) => character.name.trim())
      .filter(Boolean),
  )).slice(0, 2);
  if (speakerNames.length === 0) speakerNames.push("Narrator");

  const finalizationResponse = await apiRequest<FinalizationResponse>(
    "/master-scripts/finalize",
    {
      method: "POST",
      body: JSON.stringify({
        script_generation_draft_run: generationRun,
        script_revision_run: revisionResponse.data,
        ending_mode: generationRun.episode_context?.ending_mode
          ?? generationRun.draft_master_script.ending_mode
          ?? "serial_hook",
        // Legacy fallback only. Existing screenplay dialogue is preserved in full.
        dialogue_line_count_per_scene: 6,
        speaker_name_cycle: speakerNames,
      }),
    },
  );

  return {
    revisionRun: revisionResponse.data,
    finalizationResult: finalizationResponse.data,
  };
}
