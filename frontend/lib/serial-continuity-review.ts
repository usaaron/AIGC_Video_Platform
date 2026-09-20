import { synchronizeContinuity } from "./continuity";
import { episodeIsLocked, resolveSavedDraft } from "./script-draft-state";
import type { EpisodeWorkspace, GeneratedDraft, ScriptProject } from "./types";

export interface SerialReviewSource {
  episodeNumber: number;
  level: "saved" | "confirmed";
  sceneNumbers: number[];
}

export interface SerialReviewItem {
  id: string;
  kind: "setup" | "hook" | "storyline" | "quality";
  title: string;
  evidence: string;
  suggestion: string;
  priority: number;
  sources: SerialReviewSource[];
}

export interface SerialContinuityReview {
  throughEpisode: number;
  excludedEpisodeCount: number;
  items: SerialReviewItem[];
}

/** Read-only reminders from an uninterrupted saved prefix. Never persist this projection. */
export function serialContinuityReview(project: Pick<ScriptProject,
  "creativePrompt" | "characters" | "storyLines" | "episodes" | "generationSettings"
>): SerialContinuityReview {
  const available = project.episodes.filter(episode => episode.episodeNumber <= project.generationSettings.episodeCount)
    .slice().sort((left, right) => left.episodeNumber - right.episodeNumber);
  const saved: EpisodeWorkspace[] = [];
  const drafts = new Map<number, GeneratedDraft>();
  const levels = new Map<number, SerialReviewSource["level"]>();
  for (const episode of available) {
    if (episode.episodeNumber !== saved.length + 1 || episode.sourceAmendment
      || episode.hasLocalDraftEdits || episode.modificationCandidate || episode.pendingAuthorConflict
      || episode.deepeningRun?.candidate_draft_master_script) break;
    const draft = resolveSavedDraft(episode);
    if (!draft) break;
    const confirmed = episodeIsLocked(episode);
    drafts.set(episode.episodeNumber, draft);
    levels.set(episode.episodeNumber, confirmed ? "confirmed" : "saved");
    // Existing continuity code reads the working JSON before confirmed JSON.
    // Feed it only the resolved saved body, so locked episodes keep their source.
    saved.push({ ...episode, workingDraftJson: JSON.stringify(draft),
      generationRun: { ...episode.generationRun, draft_master_script: draft,
        // A report belongs to its generation body, not to a later manual edit.
        continuity_qc_report: sameBody(draft, episode.generationRun.draft_master_script)
          ? episode.generationRun.continuity_qc_report : null } });
  }
  const result: SerialContinuityReview = { throughEpisode: saved.length,
    excludedEpisodeCount: available.length - saved.length, items: [] };
  if (!saved.length) return result;
  // Keep authored line definitions, but replay their progress from the safe
  // bodies rather than trusting a projection that may include a candidate.
  const lines = project.storyLines.filter(line => line.source === "story_bible").map(line => ({
    ...line, status: "setup" as const, currentState: undefined, lastProgressedEpisode: undefined,
    nextRequiredStep: undefined, episodeBeats: [], warnings: [], health: "on_track" as const,
  }));
  const continuity = synchronizeContinuity(project.creativePrompt, [], saved, lines);
  const source = (episodeNumber: number, sceneNumbers: number[] = []): SerialReviewSource[] => {
    const level = levels.get(episodeNumber), draft = drafts.get(episodeNumber);
    return level && draft ? [{ episodeNumber, level,
      sceneNumbers: [...new Set(sceneNumbers)].filter(number => draft.scenes.some(scene => scene.scene_number === number)).sort((a, b) => a - b) }] : [];
  };
  const sourcesFor = (entries: Array<{ episodeNumber: number; evidenceSceneNumbers?: number[] }>) => {
    const merged = new Map<number, number[]>();
    for (const entry of entries) merged.set(entry.episodeNumber, [...(merged.get(entry.episodeNumber) ?? []), ...(entry.evidenceSceneNumbers ?? [])]);
    return [...merged].sort(([a], [b]) => a - b).flatMap(([number, scenes]) => source(number, scenes));
  };
  for (const record of continuity.setupPayoffs) {
    const paidOff = record.status === "paid_off";
    const payoffConfirmed = paidOff && record.payoffEpisode != null && levels.get(record.payoffEpisode) === "confirmed";
    const overdue = record.status === "overdue";
    const warnings = record.warnings ?? [];
    const warningEpisodes = warnings.flatMap(warning => {
      const number = /^第\s*(\d+)\s*集/.exec(warning)?.[1];
      return number ? [{ episodeNumber: Number(number) }] : [];
    });
    const hasConfirmedEvidence = (action: "setup" | "payoff") => record.history.some(change =>
      (action === "setup" ? ["setup", "reinforce"].includes(change.action)
        || (change.action === "payoff" && record.setupEpisode === record.payoffEpisode) : change.action === "payoff")
      && levels.get(change.episodeNumber) === "confirmed"
      && source(change.episodeNumber, change.evidenceSceneNumbers)[0]?.sceneNumbers.length);
    const evidenceConfirmed = payoffConfirmed && hasConfirmedEvidence("setup") && hasConfirmedEvidence("payoff");
    if (paidOff && evidenceConfirmed && !warnings.length) continue;
    if (paidOff) {
      result.items.push({ id: `setup:${record.ref}`, kind: "setup", priority: 3,
        title: payoffConfirmed ? "伏笔回收依据仍需核对" : "伏笔回收结果待确认",
        evidence: [record.description, payoffConfirmed ? "回收稿已确认，但铺设或回收的来源仍有待确认、缺少场次依据或原始提醒。" : "已保存稿记录了回收，尚未确认。",
          ...warnings].filter(Boolean).join("\n"),
        suggestion: "对照铺设与回收场景核实因果和证据，再决定是否确认正文；当前提醒不代表回收已经充分。",
        sources: sourcesFor([...record.history, ...warningEpisodes, { episodeNumber: record.payoffEpisode ?? record.lastUpdatedEpisode }]),
      });
      continue;
    }
    if (!overdue && !warnings.length && !record.targetPayoffEpisode && !record.nextRequiredStep) continue;
    result.items.push({ id: `setup:${record.ref}`, kind: "setup", priority: overdue ? 1 : warnings.length ? 2 : 4,
      title: overdue ? "伏笔已到计划回收集" : warnings.length ? "伏笔落实需要核对" : "后续伏笔待回收",
      evidence: [record.description, record.targetPayoffEpisode ? `计划在第 ${record.targetPayoffEpisode} 集回收。` : "", ...warnings].filter(Boolean).join("\n"),
      suggestion: record.nextRequiredStep || "回看铺设与回收场景；如决定延后，在后续规划中明确新的承接安排。",
      sources: sourcesFor([...record.history, ...warningEpisodes, { episodeNumber: record.lastUpdatedEpisode }]),
    });
  }
  for (const hook of continuity.continuationHooks) {
    if (hook.status === "fulfilled") {
      const fulfilledEpisode = hook.fulfilledEpisode;
      const confirmed = fulfilledEpisode != null && levels.get(fulfilledEpisode) === "confirmed";
      const originConfirmed = levels.get(hook.episodeNumber) === "confirmed";
      const scenes = fulfilledEpisode != null ? source(fulfilledEpisode, hook.evidenceSceneNumbers)[0]?.sceneNumbers ?? [] : [];
      if (confirmed && originConfirmed && scenes.length > 0) continue;
      result.items.push({ id: `hook:${hook.episodeNumber}`, kind: "hook", priority: 3,
        title: confirmed ? "悬念承接依据仍需核对" : "悬念承接结果待确认",
        evidence: [hook.summary, hook.responseSummary, confirmed ? "承接稿已确认，但悬念来源仍待确认或回应缺少有效场次依据。" : "已保存稿记录了承接，尚未确认。"].filter(Boolean).join("\n"),
        suggestion: "回看集尾悬念和后续回应，确认观众能从实际场景理解承接过程。",
        sources: sourcesFor([{ episodeNumber: hook.episodeNumber }, ...(fulfilledEpisode == null ? [] : [{ episodeNumber: fulfilledEpisode, evidenceSceneNumbers: scenes }])]),
      });
      continue;
    }
    result.items.push({ id: `hook:${hook.episodeNumber}`, kind: "hook", priority: hook.status === "overdue" ? 1 : 4,
      title: hook.status === "overdue" ? "集尾悬念已到承接集" : "集尾悬念待承接",
      evidence: [hook.summary, hook.targetPayoffEpisode ? `计划在第 ${hook.targetPayoffEpisode} 集承接。` : ""].filter(Boolean).join("\n"),
      suggestion: hook.nextEpisodeObligation || "核对下一集是否通过实际行动回应本集悬念。",
      sources: source(hook.episodeNumber),
    });
  }
  for (const line of continuity.storyLines) {
    if (line.status === "resolved" || !line.warnings?.length) continue;
    const flagged = line.episodeBeats.filter(beat => beat.alignment === "missing" || beat.alignment === "deviated");
    const sources = sourcesFor(flagged);
    if (!sources.length) continue;
    result.items.push({ id: `storyline:${line.id}`, kind: "storyline", priority: 2,
      title: `剧情线待核对：${line.title}`, evidence: line.warnings.join("\n"),
      suggestion: line.nextRequiredStep || "对照批准规划，确认本集的新变化、人物选择和代价是否已经落在具体场景中。", sources });
  }
  for (const episode of saved) {
    const report = episode.generationRun.continuity_qc_report;
    if (!report || report.status === "passed" || report.status === "not_applicable") continue;
    for (const issue of report.issues ?? []) {
      if (!issue.summary?.trim()) continue;
      result.items.push({ id: `quality:${episode.episodeNumber}:${issue.issue_id}`, kind: "quality",
        priority: issue.severity === "blocking" ? 0 : 3, title: "保存稿的衔接检查提醒",
        evidence: [issue.summary, issue.current_evidence].filter(Boolean).join("\n"),
        suggestion: issue.suggested_action || "回看相关场景，再决定是否修改正文或调整后续规划。",
        sources: source(episode.episodeNumber, issue.scene_numbers) });
    }
  }
  result.items = result.items.filter(item => item.sources.length).sort((a, b) => a.priority - b.priority
    || a.sources[0].episodeNumber - b.sources[0].episodeNumber || a.id.localeCompare(b.id));
  return result;
}

function sameBody(left: GeneratedDraft, right: GeneratedDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
