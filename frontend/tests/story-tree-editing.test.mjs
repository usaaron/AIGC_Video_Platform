import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hasCompleteStoryPlanChildCoverage } from "../lib/story-plan-coverage.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the recursive story tree has one resumable full-tree coordinator", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const coordinator = await source("lib/story-tree-expansion.ts");
  const roadmapCoordinator = await source("lib/episode-roadmap-generation.ts");
  const background = await source("lib/story-planning-background.ts");

  assert.match(panel, /kind:\s*"full_tree"/);
  assert.match(panel, /runFullStoryTreeExpansion/);
  assert.match(panel, /summarizeStoryPlanTreeProgress/);
  assert.match(panel, /treeProgress\.expansionComplete/);
  assert.match(panel, /storyPlanNode\.roadmapOverallProgress/);
  assert.match(panel, /runFullEpisodeRoadmapGeneration/);
  assert.doesNotMatch(panel, /kind:\s*"quality_audit"/);
  assert.doesNotMatch(panel, /storyPlanNode\.qualityStage/);
  assert.doesNotMatch(panel, /qualityPassed/);
  assert.match(panel, /storyPlanNode\.generateAllRoadmaps/);
  assert.match(panel, /storyPlanNode\.continueAllRoadmaps/);
  assert.match(panel, /useTrackedPlanningTask/);
  // Whole-run state includes failures completed while the planning route was
  // unmounted; per-node interactions retain page-local tracking.
  assert.match(panel, /const topLevelTask = usePlanningTask\(topLevelTaskKey\)/);
  assert.match(panel, /const roadmapBatchTask = usePlanningTask\(roadmapBatchTaskKey\)/);
  assert.match(panel, /usePlanningProgress\(topLevelTaskKey\)/);
  assert.match(panel, /usePlanningProgress\(roadmapBatchTaskKey\)/);
  assert.match(coordinator, /FULL_TREE_INITIAL_CONCURRENCY = 3/);
  assert.match(coordinator, /FULL_TREE_MINIMUM_CONCURRENCY = 2/);
  assert.match(coordinator, /FULL_TREE_MAXIMUM_CONCURRENCY = 4/);
  assert.match(coordinator, /FULL_TREE_SLOW_TASK_THRESHOLD_MS = 120_000/);
  assert.match(coordinator, /runAdaptiveDependencyQueue/);
  assert.match(coordinator, /successfulNodesByDepth/);
  assert.match(coordinator, /\.\.\.\(!error \? \{/);
  assert.match(coordinator, /minimumConcurrency: FULL_TREE_MINIMUM_CONCURRENCY/);
  assert.match(coordinator, /maximumConcurrency: FULL_TREE_MAXIMUM_CONCURRENCY/);
  assert.match(coordinator, /breadthFirst: true/);
  assert.match(coordinator, /loadActiveStoryPlanNodes/);
  assert.match(coordinator, /onTreeCheckpoint/);
  assert.match(coordinator, /onRoadmapCheckpoint/);
  assert.match(coordinator, /decomposeStoryPlanNode\([\s\S]*authorInstruction:\s*input\.authorInstruction/);
  assert.match(coordinator, /checkpointRebasedRoadmaps/);
  assert.match(coordinator, /episodeReadyLeafNodes\(activeNodes\)/);
  assert.doesNotMatch(coordinator, /generateEpisodePlanBatch/);
  assert.match(roadmapCoordinator, /generateEpisodePlanBatch/);
  assert.match(roadmapCoordinator, /auditStoryPlanQuality/);
  assert.match(roadmapCoordinator, /storyPlanQualityAuditMatchesNodes/);
  assert.match(roadmapCoordinator, /onQualityCheckpoint/);
  assert.match(roadmapCoordinator, /onCheckpoint/);
  assert.match(roadmapCoordinator, /episodeReadyStoryPlanLeaves/);
  assert.match(roadmapCoordinator, /episodeRoadmaps: workingRoadmaps/);
  assert.match(background, /"full_tree"/);
  assert.match(background, /FULL_TREE_RESERVED_SLOTS = 4/);
  assert.match(background, /const result = await task\.run\(\)/);
  assert.doesNotMatch(background, /generateWithFailurePolicy/);
});

test("planning progress lives in the shared directory without duplicating task controls", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const directory = await source("components/workspace-section-directory.tsx");
  const backgroundStatus = await source("components/background-generation-status.tsx");
  const styles = await source("app/globals.css");

  assert.doesNotMatch(panel, /<div className="story-bible-heading">/);
  assert.match(panel, /document-edit-toolbar story-plan-document-toolbar/);
  assert.match(panel, /story-plan-stage-summary/);
  assert.match(panel, /planningProgressDetail/);
  assert.match(styles, /\.story-plan-document-toolbar\s*\{/);
  assert.match(directory, /workspace-section-directory-progress/);
  assert.match(directory, /workspaceSectionAccess/);
  assert.doesNotMatch(directory, /requestPlanningPause|requestScriptGenerationPause/);
  assert.match(backgroundStatus, /requestPlanningPause/);
  assert.match(backgroundStatus, /requestScriptGenerationPause/);
  assert.match(backgroundStatus, /resumePlanningTasks/);
  assert.match(backgroundStatus, /resumeScriptGenerationTask/);
  assert.match(styles, /story-plan-node-panel > \.story-plan-workbench[\s\S]*height:\s*calc\(100dvh - var\(--app-topbar-height\)\)/);
});

test("top-level directions stay round-scoped and workflow advancement stays global", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const styles = await source("app/globals.css");

  assert.doesNotMatch(panel, /story-plan-interaction-panel/);
  assert.match(panel, /story-plan-round-control/);
  assert.match(panel, /aria-expanded=\{treeInstructionOpen\}/);
  assert.match(panel, /仅作用于当前轮/);
  assert.match(panel, /const roundInstruction = treeAuthorInstruction\.trim\(\)/);
  assert.match(panel, /treeAuthorInstruction:\s*""/);
  assert.doesNotMatch(
    panel,
    /persistProjectUpdate\(onProjectUpdate, \{ planningSession: updatePlanningSession\(project, \{ phase: "story_tree", status: "active", treeAuthorInstruction:/,
  );
  assert.match(panel, /runNextPlanningStage/);
  assert.doesNotMatch(panel, /剧情节点控制/);
  assert.doesNotMatch(panel, /storyPlanNode\.decompose/);
  assert.match(styles, /\.story-plan-round-control-popover\s*\{/);
  assert.match(
    styles,
    /\.story-plan-node-card\.is-document-node \.story-plan-episode-plans article\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/,
  );
  assert.match(styles, /story-plan-episode-plans article > strong,[\s\S]*grid-column:\s*1 \/ -1/);
});

test("confirmed outline enters planning and confirms only after a saved complete roadmap", async () => {
  const workspace = await source("components/story-planning-workspace.tsx");
  const storyBible = await source("components/story-bible-panel.tsx");
  const panel = await source("components/story-plan-node-panel.tsx");
  const styles = await source("app/globals.css");

  assert.doesNotMatch(workspace, /router\.replace\(`\/projects\/\$\{project\.id\}\/planning\/structure`\)/);
  assert.match(storyBible, /router\.push\(`\/projects\/\$\{project\.id\}\/planning\/structure`\)/);
  assert.doesNotMatch(panel, /autoFirstLayerRequestedRef/);
  assert.doesNotMatch(panel, /saveCurrentLayer\(\)/);
  assert.doesNotMatch(panel, /storyPlanNode\.saveLayer/);
  assert.match(panel, /finalProgress\.generatedRoadmapCount !== (?:project|requestProject)\.generationSettings\.episodeCount/);
  assert.match(panel, /syncProjectSnapshot\((?:project|requestProject)\)/);
  assert.match(panel, /savePlanningCheckpoint/);
  assert.match(panel, /storyPlanNode\.confirmPlanning/);
  // Evaluate the actual route expression so nested host checks do not invalidate
  // the old no-closing-parenthesis regex, and both surface contracts are checked.
  const navigation = panel.match(/router\.push\((isHostScriptWorkflow\(\) \? `\/projects\/[\s\S]*?)\);/)?.[1];
  assert.ok(navigation, "planning confirmation must select a script workspace route");
  const destination = new Function("isHostScriptWorkflow", "requestProject", "effectiveOutputMode", `return (${navigation});`);
  assert.equal(destination(() => true, { id: "story" }, "script_only"), "/projects/story/workspace");
  assert.equal(destination(() => false, { id: "story" }, "script_only"), "/projects/story/workspace?generate=1");
  assert.equal(destination(() => false, { id: "story" }, "script_and_storyboard"), "/projects/story/workspace?generate=1&autoStoryboard=1");
  assert.doesNotMatch(panel, /storyPlanNode\.generateEpisodeScript/);
  assert.doesNotMatch(panel, /storyPlanNode\.roadmapPending/);
  assert.doesNotMatch(panel, /story-plan-episode-script-link/);
  assert.match(styles, /--workspace-directory-width:\s*260px/);
  assert.match(styles, /workspace-section-directory-children button span \{[^}]*white-space:\s*normal/);
  assert.match(styles, /grid-template-columns:\s*var\(--workspace-directory-width\)/);
  assert.match(panel, /episodeRoadmapDisplayTitle/);
  assert.match(panel, /return "本集待命名"/);
  assert.match(panel, /第\$\{item\.episode_number\}集 \$\{episodeRoadmapDisplayTitle\(item\)\}/);
});

test("episode roadmaps use bounded chunks while preserving per-episode checkpoints", async () => {
  const client = await source("lib/story-planning-client.ts");
  const coordinator = await source("lib/episode-roadmap-generation.ts");

  assert.match(client, /episode-plans\/chunk/);
  assert.match(client, /stableAgentRequestId\(\s*"episode-roadmap-chunk"/);
  assert.match(client, /agent_request_id:\s*agentRequestId/);
  assert.match(client, /const remainingEpisodeCount =/);
  assert.match(client, /response\.data\.length === 0/);
  assert.match(client, /response\.data\.length > remainingEpisodeCount/);
  assert.match(client, /accepted_plans:\s*accepted\.map/);
  assert.match(client, /scene_execution_plan:\s*_sceneExecutionPlan/);
  assert.match(client, /layer_contracts:\s*_layerContracts/);
  assert.match(client, /current_plan:\s*\{[\s\S]*scene_execution_plan:\s*item\.scene_execution_plan/);
  assert.match(client, /for \(const \[offset, generated\] of response\.data\.entries\(\)\)/);
  assert.match(client, /await onCheckpoint\?\.\(checkpoint\)/);
  assert.match(coordinator, /onCheckpoint/);
});

test("active tree refresh loads one history snapshot instead of one request per node", async () => {
  const client = await source("lib/story-planning-client.ts");

  assert.match(client, /function activeStoryPlanNodesFromHistory/);
  assert.match(
    client,
    /loadActiveStoryPlanNodes[\s\S]*loadStoryPlanNodeHistory[\s\S]*activeStoryPlanNodesFromHistory/,
  );
  assert.doesNotMatch(
    client,
    /loadActiveStoryPlanNodes[\s\S]*Promise\.all\(frontier\.map/,
  );
});

test("approved sibling versions keep a complete saved layer resumable", () => {
  const root = coverageNode({
    node_id: "root",
    version: 1,
    sequence_order: 1,
    planned_start_episode: 1,
    planned_end_episode: 100,
  });
  const children = [
    coverageNode({
      node_id: "branch-1",
      version: 14,
      parent_node_id: "root",
      parent_node_version: 1,
      sequence_order: 1,
      planned_start_episode: 1,
      planned_end_episode: 50,
    }),
    coverageNode({
      node_id: "branch-2",
      version: 14,
      parent_node_id: "root",
      parent_node_version: 1,
      predecessor_node_id: "branch-1",
      predecessor_node_version: 13,
      sequence_order: 2,
      planned_start_episode: 51,
      planned_end_episode: 100,
    }),
  ];

  assert.equal(hasCompleteStoryPlanChildCoverage(root, children), true);
  assert.equal(hasCompleteStoryPlanChildCoverage(root, [
    children[0],
    { ...children[1], predecessor_node_version: 15 },
  ]), false);
});

test("parent revisions require an explicit descendant policy", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.match(panel, /descendantDecisionKeep/);
  assert.match(panel, /descendantDecisionResplit/);
  assert.match(panel, /persistNode\([^)]*"rebase"\)/s);
  assert.match(panel, /persistNode\([^)]*"invalidate"\)/s);
  assert.match(panel, /await requestNodeSave\(candidate, "ai"\)/);
  assert.match(panel, /activeBranchInteractions\.size > 0/);
  assert.match(panel, /onInteractionChange=\{updateBranchInteraction\}/);
  assert.doesNotMatch(panel, /story-plan-node-action-menu/);
  assert.doesNotMatch(panel, /workflow\.action === "decompose"/);
  assert.match(panel, /onRequestResplit\?\.\(\)/);
  assert.doesNotMatch(panel, /decomposeNode\(authorInstruction = ""\)/);
  assert.doesNotMatch(panel, /function generateRoadmap\(\)/);
  assert.match(panel, /runFullStoryTreeExpansion/);
  assert.match(panel, /generateAllEpisodeRoadmaps/);
  assert.match(panel, /previousVersions\.get\(item\.source_node_id\)/);
  assert.match(client, /baselineChildVersions/);
  assert.match(client, /const existing = \(options\?\.regenerate \? \[\]/);
  assert.match(panel, /autoExpansionRequested/);
  assert.match(panel, /onRoadmapCheckpoint: async/);
  assert.match(panel, /onTreeCheckpoint:/);
  assert.match(panel, /await persistProjectUpdate/);
  assert.match(panel, /const episodeRoadmaps = guided[\s\S]*\? mergeEpisodeRoadmaps\(current\.episodeRoadmaps \?\? \[\], result\.episodeRoadmaps\)[\s\S]*: current\.episodeRoadmaps \?\? \[\]/);
  assert.match(panel, /const branchLocked = operationLocked/);
  assert.match(panel, /const concurrentLeafAccess = treeBusy/);
  assert.match(panel, /treeUnlockedNodeIds/);
  assert.doesNotMatch(panel, /decomposeTaskActive/);
  assert.doesNotMatch(panel, /roadmapTaskActive/);
  assert.doesNotMatch(panel, /!storyQualityReady/);
  assert.match(panel, /depth === 0 && !effectiveEditing/);
  assert.match(panel, /depth === 1 && !effectiveEditing/);
  assert.match(client, /descendant_policy=\$\{descendantPolicy\}/);
});

test("story parts do not expose individual confirmation controls", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const locale = await source("providers/locale-provider.tsx");

  assert.doesNotMatch(panel, /saveCurrentLayer\(\)/);
  assert.doesNotMatch(panel, /storyPlanNode\.saveLayer/);
  assert.match(panel, /!treeProgress\.expansionComplete/);
  assert.match(panel, /void expandFullTree\(\)/);
  assert.doesNotMatch(panel, /workflow\.action === "confirm"/);
  assert.doesNotMatch(panel, /workflow\.action === "approve"/);
  assert.doesNotMatch(panel, /story-plan-node-state/);
  assert.doesNotMatch(panel, /storyPlanNode\.statusApproved/);
  assert.doesNotMatch(locale, /"storyPlanNode\.confirm":/);
  assert.doesNotMatch(locale, /"storyPlanNode\.confirming":/);
  assert.doesNotMatch(locale, /"storyPlanNode\.confirmed":/);
  assert.doesNotMatch(locale, /"storyPlanNode\.statusApproved"/);
  assert.match(locale, /"workspace\.confirmEpisode"/);
});

test("episode roadmaps use the shared selection chat for targeted revision", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.doesNotMatch(panel, /storyPlanNode\.editRoadmap/);
  assert.doesNotMatch(panel, /storyPlanNode\.aiEditRoadmap/);
  assert.doesNotMatch(panel, /<EpisodeRoadmapEditorDialog/);
  assert.match(panel, /requestRoadmapAiModification/);
  assert.match(panel, /className="story-bible-inline-document-text"/);
  assert.match(panel, /contentEditable/);
  assert.match(panel, /await applyRoadmapRevision\(candidate, targetOverride\)/);
  assert.match(panel, /story-plan-undo/);
  assert.match(panel, /replaceEpisodeRoadmapItem/);
  assert.doesNotMatch(panel, /approveRoadmap/);
  assert.match(client, /export async function modifyEpisodePlanItem/);
  assert.match(client, /episode-plans\/\$\{item\.episode_number\}\/modify/);
  assert.match(client, /predecessor_plan: predecessorPlan/);
});

test("planning document text is directly editable without bypassing its locks", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const roadmapRevision = panel.slice(
    panel.indexOf("async function applyRoadmapRevision"),
    panel.indexOf("function describeAppliedRevision"),
  );
  const roadmapDocument = panel.slice(
    panel.indexOf("{roadmap.map((item) => ("),
    panel.indexOf("{message ? <div", panel.indexOf("{roadmap.map((item) => (")),
  );

  assert.doesNotMatch(panel, /compactTopLevelSynopsis/);
  assert.match(
    panel,
    /className="story-plan-node-title"[^>]*>\s*<InlinePlanningText\s+label=\{t\("storyPlanNode\.nodeTitle"\)\}\s+locked=\{nodeRevisionLocked\}[\s\S]*?onChange=\{\(value\) => updateNodeField\("title", value\)\}[\s\S]*?value=\{node\.title\}/,
  );
  assert.match(
    panel,
    /label=\{t\("storyPlanNode\.synopsis"\)\}[\s\S]*?showLabel=\{false\}[\s\S]*?value=\{node\.synopsis\}/,
  );
  assert.doesNotMatch(panel, /story-plan-node-title"[^>]*contentEditable/);

  for (const field of ["episode_title", "episode_goal", "central_conflict", "ending_hook_type", "cliffhanger"]) {
    assert.match(roadmapDocument, new RegExp(`updateRoadmapTextField\\(item, "${field}"`));
  }
  for (const field of ["scene_heading", "scene_objective"]) {
    assert.match(roadmapDocument, new RegExp(`"${field}",\\s*value`));
  }
  assert.match(roadmapDocument, /<InlinePlanningText/);
  assert.match(panel, /function InlinePlanningText[\s\S]*contentEditable=\{!locked\}/);
  assert.match(
    panel,
    /function roadmapItemLocked[\s\S]*planningLocked \|\| rebuildTaskActive \|\| treeInteractionLocked[\s\S]*busy !== "save"[\s\S]*planningRevisionEpisodeLocked[\s\S]*generatedRangeLocked/,
  );
  assert.match(roadmapRevision, /if \(treeInteractionLocked \|\| roadmapItemLocked\(previousItem \?\? candidate\)\) return false;/);

  assert.match(roadmapRevision, /persistProjectUpdate\(onProjectUpdate, \(current\) =>/);
  assert.match(roadmapRevision, /const currentRoadmap = current\.episodeRoadmaps \?\? \[\]/);
  assert.match(roadmapRevision, /sameEpisodeRoadmapIdentity\(item, previousItem \?\? candidate\)/);
  assert.match(roadmapRevision, /mergeWithLatest \? mergeWithLatest\(latestItem\) : candidate/);
  assert.match(roadmapRevision, /roadmapManualRevisionTailRef\.current\.then/);
  assert.match(roadmapRevision, /onRegisterRevision\?\.\(async \(\) =>/);
  assert.match(roadmapRevision, /await applyRoadmapRevision\(snapshot, appliedCandidate, false\)/);
});

function coverageNode(overrides) {
  return {
    node_id: "node",
    version: 1,
    parent_node_id: null,
    parent_node_version: null,
    predecessor_node_id: null,
    predecessor_node_version: null,
    sequence_order: 1,
    planned_start_episode: 1,
    planned_end_episode: 1,
    ...overrides,
  };
}
