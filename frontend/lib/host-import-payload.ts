import { toEpisodePlainText } from "./episode-export.ts";
import { buildEmbeddedOverseasDialogueView } from "./generation-client.ts";
import { resolveSavedDraft } from "./script-draft-state.ts";
import { sameStoryboardSource, type Storyboard } from "./storyboard.ts";
import { projectHostAssetEvidence, type PendingHostAssetEvidence } from "./host-asset-evidence.ts";
import type { ScriptProject } from "./types.ts";

export interface ImportAsset {
  sourceAssetId: string; kind: "character" | "scene" | "prop" | "costume";
  name: string; description: string; prompt: string; subjectType: "human" | "animal";
}
export interface ImportShot { sourceShotId: string; title: string; framing: string; duration: number; prompt: string; continuityNote: string }
export interface ImportEpisode { sourceEpisodeId: string; episodeNumber: number; title: string; content: string; shots?: ImportShot[]; assetEvidence?: PendingHostAssetEvidence }
export interface ImportMaterial { episodes: ImportEpisode[]; assets: ImportAsset[]; warnings: string[] }
export interface ImportReadOptions { scriptsOnly?: boolean }

export function buildImportMaterial(project: ScriptProject, boards: Map<number, Storyboard | null>, options: ImportReadOptions = {}): ImportMaterial {
  const assets = new Map<string, ImportAsset>();
  const warnings: string[] = [];
  function asset(kind: ImportAsset["kind"], rawName: string, description = "") {
    if (options.scriptsOnly) return;
    const name = rawName.trim();
    if (!name) return;
    const key = `${kind}:${name.normalize("NFKC").toLocaleLowerCase()}`;
    if (name.length > 120 || key.length > 160) throw new Error(`资产名称“${name.slice(0, 30)}”过长，请先缩短名称。`);
    const previous = assets.get(key);
    if (previous && previous.prompt.length >= description.length) return;
    if (description.length > 5000) throw new Error(`资产“${name}”的描述超过主项目限制，请先精简。`);
    assets.set(key, { sourceAssetId: key, kind, name, description: description.slice(0, 500), prompt: description || name, subjectType: "human" });
  }
  for (const character of project.characters ?? []) asset("character", character.name, [character.appearance, character.description, character.background, character.motivation].filter(Boolean).join("\n"));
  const episodes = project.episodes.filter(e => e.episodeNumber <= project.generationSettings.episodeCount && resolveSavedDraft(e)).sort((a, b) => a.episodeNumber - b.episodeNumber).map(episode => {
    const draft = resolveSavedDraft(episode)!;
    for (const character of draft.characters ?? []) asset("character", character.name, [character.description, character.motivation].filter(Boolean).join("\n"));
    for (const location of draft.locations ?? []) asset("scene", location);
    for (const scene of draft.scenes ?? []) {
      const location = scene.setting?.trim() || scene.setting_hint?.trim() || scene.scene_heading?.trim() || scene.slug;
      asset("scene", location, location);
      for (const prop of scene.content_manifest?.props ?? []) asset("prop", prop);
    }
    const result: ImportEpisode = { sourceEpisodeId: episode.id, episodeNumber: episode.episodeNumber, title: draft.title || `第 ${episode.episodeNumber} 集`, content: toEpisodePlainText(draft, episode.episodeNumber, buildEmbeddedOverseasDialogueView(draft)) };
    const projected = projectHostAssetEvidence(draft, project.characters ?? [], episode.id, result.content);
    if (projected.evidence) result.assetEvidence = projected.evidence;
    if (projected.warning) warnings.push(`第 ${episode.episodeNumber} 集${projected.warning}`);
    if (options.scriptsOnly) return result;
    const board = boards.get(episode.episodeNumber);
    if (!board) { warnings.push(`第 ${episode.episodeNumber} 集尚未保存分镜，可先导入正文和资产。`); return result; }
    if (board.status === "source_changed" || board.stale_scene_numbers.length || !sameStoryboardSource(board.source_draft, draft)) {
      warnings.push(`第 ${episode.episodeNumber} 集分镜与已保存正文不一致，本次不导入该集分镜。`); return result;
    }
    if (board.candidate) warnings.push(`第 ${episode.episodeNumber} 集仍有未采用的候选，本次只读取已保存分镜。`);
    try { result.shots = board.scenes.flatMap(scene => scene.shots.map((shot, index) => {
      if (shot.duration_seconds < 3 || shot.duration_seconds > 15) throw new Error(`第 ${episode.episodeNumber} 集镜头 ${scene.scene_number}-${index + 1} 为 ${shot.duration_seconds} 秒。主项目支持 3–15 秒，请在分镜页拆分或调整后重新读取。`);
      const source = draft.scenes.find(s => s.scene_number === scene.scene_number);
      const prompt = shot.prompt || [source?.scene_heading || source?.setting || source?.slug, `镜头作用：${shot.purpose}`, `运镜：${shot.camera}`, ...shot.action_sequence, ...shot.dialogue, shot.sound && `声音：${shot.sound}`].filter(Boolean).join("\n");
      const continuityNote = `起始：${shot.continuity_in}\n结束：${shot.continuity_out}`;
      if (prompt.length > 5000 || shot.framing.length > 80 || continuityNote.length > 2000) throw new Error(`第 ${episode.episodeNumber} 集镜头 ${scene.scene_number}-${index + 1} 描述超过主项目长度限制，请精简后重新读取。`);
      const duration = Math.round(shot.duration_seconds);
      if (duration !== shot.duration_seconds) warnings.push(`第 ${episode.episodeNumber} 集镜头 ${scene.scene_number}-${index + 1} 时长按主项目精度取整为 ${duration} 秒。`);
      return { sourceShotId: shot.shot_id, title: `第${episode.episodeNumber}集 · ${scene.scene_number}-${index + 1}`, framing: shot.framing, duration, prompt, continuityNote };
    })); } catch (error) { warnings.push(`${error instanceof Error ? error.message : '分镜读取失败。'} 本次不导入该集分镜。`); }
    return result;
  });
  return { episodes, assets: [...assets.values()], warnings };
}
