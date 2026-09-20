"use client";

import { useEffect, useRef, useState } from "react";
import { hostProjectId } from "@/lib/host-session";
import { isHostEmbedded, isHostScriptWorkflow, notifyHost } from "@/lib/host-navigation";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import { HostWorkspaceLink } from "@/components/host-return-link";
import { HostImportError, importMaterial, loadImportTargets, readImportMaterial, type ImportReceipt } from "@/lib/host-import";
import type { ImportMaterial } from "@/lib/host-import-payload";
import type { ScriptProject } from "@/lib/types";

export function HostImportPanel({ project, onTarget, onClose }: { project: ScriptProject; onTarget: (id: string) => void; onClose: () => void }) {
  const scriptWorkflow = useHostScriptWorkflow();
  const [embedded, setEmbedded] = useState(false);
  const [targets, setTargets] = useState<Array<{ id: string; name: string }>>([]);
  const [target, setTarget] = useState(hostProjectId() ?? project.hostDeliveryTargetProjectId ?? "");
  const [material, setMaterial] = useState<ImportMaterial | null>(null);
  const [episodeIds, setEpisodeIds] = useState<string[]>([]);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [includeShots, setIncludeShots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const [storyboardConflict, setStoryboardConflict] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const receiptElement = useRef<HTMLParagraphElement>(null);
  const current = useRef(project);
  current.current = project;
  const loadedAt = useRef("");
  const mounted = useRef(true);
  const requestInFlight = useRef(false);
  const boundProjectId = hostProjectId();
  const boundTarget = embedded && Boolean(boundProjectId);
  const selectedEpisodeCount = material?.episodes.filter(episode => episodeIds.includes(episode.sourceEpisodeId)).length ?? 0;
  const selectedShotCount = !scriptWorkflow && includeShots ? material?.episodes
    .filter(episode => episodeIds.includes(episode.sourceEpisodeId))
    .reduce((sum, episode) => sum + (episode.shots?.length ?? 0), 0) ?? 0 : 0;
  const selectedAssetCount = !scriptWorkflow && includeAssets ? material?.assets.length ?? 0 : 0;
  const hasContent = Boolean(material && (material.episodes.length || material.assets.length));
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    if (isHostEmbedded()) {
      setEmbedded(true);
      void read();
    }
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (receipt) receiptElement.current?.scrollIntoView({ block: "nearest" }); }, [receipt]);
  async function read() {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError(""); setReceipt(null); setMaterial(null); setStoryboardConflict(false);
    const snapshot = current.current;
    try {
      const [available, result] = await Promise.all([loadImportTargets(), readImportMaterial(snapshot, { scriptsOnly: isHostScriptWorkflow() })]);
      if (!mounted.current) return;
      if (snapshot.updatedAt !== current.current.updatedAt) throw new Error("读取期间剧本内容发生变化，请重新读取。");
      const scopedId = isHostEmbedded() ? hostProjectId() : null;
      const allowed = scopedId ? available.filter(item => item.id === scopedId) : available;
      setTargets(allowed); setMaterial(result); setEpisodeIds(result.episodes.map(e => e.sourceEpisodeId));
      loadedAt.current = snapshot.updatedAt;
      setTarget(value => allowed.some(p => p.id === value) ? value : allowed.length === 1 ? allowed[0].id : "");
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "读取失败，请重试。"); }
    finally { requestInFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function submit(storyboardRevision?: "preserve-history") {
    if (!material || requestInFlight.current || !target) return;
    if (storyboardRevision && (!storyboardConflict || !isHostScriptWorkflow())) return;
    if (loadedAt.current !== current.current.updatedAt) { setError(embedded ? "创作内容已有更新，请刷新内容后再同步。" : "剧本已修改，请重新读取后导入。"); return; }
    requestInFlight.current = true;
    setSubmitting(true);
    setBusy(true); setError(""); setReceipt(null);
    try {
      const scriptsOnly = isHostScriptWorkflow();
      const result = await importMaterial(current.current, target, material, { episodeIds, assets: !scriptsOnly && includeAssets, shots: !scriptsOnly && includeShots, ...(storyboardRevision ? { storyboardRevision } : {}) });
      if (!mounted.current) return;
      setReceipt(result); setStoryboardConflict(false); onTarget(target);
      notifyHost("synced", result.targetProjectId, result.revisionSummary ? "storyboard" : scriptsOnly ? "assets" : undefined);
    } catch (failure) {
      if (mounted.current) {
        const blockedByStoryboard = failure instanceof HostImportError && failure.code === "IMPORT_STORYBOARD_REQUIRED";
        setStoryboardConflict(blockedByStoryboard || Boolean(storyboardRevision));
        setError(blockedByStoryboard && isHostScriptWorkflow()
          ? "修改的剧集已有制作分镜，本次正文尚未同步。可以保存旧版后更新这些剧集的分镜。"
          : failure instanceof Error ? failure.message : embedded ? "同步未完成，创作内容已保留，请重试。" : "导入失败，已保存内容保留，请重试。");
      }
    }
    finally { requestInFlight.current = false; if (mounted.current) { setBusy(false); setSubmitting(false); } }
  }
  return <dialog className={`host-import-dialog${embedded ? " is-embedded-sync" : ""}`} ref={dialog} aria-labelledby="host-import-title" onCancel={event => { event.preventDefault(); if (!(embedded ? submitting : busy)) onClose(); }}>
    <header><div><h3 id="host-import-title">{scriptWorkflow ? "准备进入资产设计" : embedded ? "同步到制作" : "批量导入主项目"}</h3><p>{scriptWorkflow ? "将已保存的分集正文交给当前项目，接下来设计人物、场景和道具。" : embedded ? "将已保存的创作内容用于后续资产与分镜制作。" : "读取已保存正文、分镜和人物／场景／道具资料。"}</p></div><button aria-label={scriptWorkflow ? "关闭进入资产设计" : embedded ? "关闭同步到制作" : "关闭批量导入"} className="outline-action" disabled={embedded ? submitting : busy} onClick={onClose} type="button">关闭</button></header>
    {!embedded && <p>{boundProjectId ? "当前创作已绑定主项目，确认范围后同步到该项目。" : "导入后在主项目的剧本、资产设计和分镜中继续制作。"}不会自动生成图片、视频或扣积分。</p>}
    {embedded && boundTarget && <div className="host-sync-project"><span>当前项目</span><strong>{targets.find(item => item.id === boundProjectId)?.name || project.title}</strong></div>}
    {embedded && busy && !material && <p className="host-sync-loading" role="status">{scriptWorkflow ? "正在读取已保存的分集正文…" : "正在准备可同步的正文、分镜与资产…"}</p>}
    {(!embedded || (!busy && !receipt)) && <button className={embedded ? "text-action host-sync-refresh" : "outline-action"} disabled={busy} onClick={() => void read()} type="button">{busy ? "正在处理…" : embedded ? material ? "刷新内容" : "重新读取" : material ? "重新读取分镜与资产" : "读取分镜与资产"}</button>}
    {error && <p className="inline-notice is-error" role="alert">{error}</p>}
    {storyboardConflict && <><div className="host-sync-actions"><HostWorkspaceLink projectId={target} view="storyboard" className="outline-action">查看已有分镜</HostWorkspaceLink><HostWorkspaceLink projectId={target} view="script" className="outline-action">查看已交付版本</HostWorkspaceLink></div>{scriptWorkflow && <p className="inline-notice">确认后，旧正文、旧分镜和已有生成结果会保留在「制作修订历史」。只更新本次修改的剧集，可复用的镜头继续使用；无需重新选择项目，也不会生成图片或视频。</p>}</>}
    {material && (!embedded || !receipt) && <fieldset disabled={busy}><legend>{scriptWorkflow === true ? "选择要交付的已保存正文" : embedded ? "选择同步范围" : "导入范围"}</legend>
      {!boundTarget && <label className="host-import-target">目标主项目<select value={target} onChange={event => setTarget(event.target.value)}><option value="">请选择主项目</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {!targets.length && <p role="status">{boundTarget ? "当前项目暂时无法接收同步，请重新读取后重试。" : "没有可写入的网剧项目，请先在主站项目库新建网剧项目，再重新读取。"}</p>}
      {embedded && !hasContent ? <div className="host-sync-empty" role="status"><strong>还没有可同步的内容</strong><p>{scriptWorkflow ? "先完成并保存至少一集正文，再进入资产设计。" : "先完成并保存分集正文，再来选择要用于制作的剧集和资产。"}</p></div> : <p>{scriptWorkflow ? `已读取 ${material.episodes.length} 集已保存正文` : `已读取 ${material.episodes.length} 集 · ${material.episodes.reduce((sum, e) => sum + (e.shots?.length ?? 0), 0)} 个镜头 · ${material.assets.length} 项资产`}</p>}
      {(!embedded || hasContent) && <>
      {scriptWorkflow === false && <><label><input type="checkbox" checked={includeShots} onChange={event => setIncludeShots(event.target.checked)} />{embedded ? "包含所选剧集的已保存分镜" : "同时导入所选剧集的已保存分镜"}</label>
      <label><input type="checkbox" checked={includeAssets} onChange={event => setIncludeAssets(event.target.checked)} />{embedded ? "包含全部人物、场景和道具等资产（跨集同名同类合并）" : "读取的全部资产（跨集同名同类合并）"}</label></>}
      <div className="host-import-episodes"><button className="text-action" type="button" onClick={() => setEpisodeIds(material.episodes.map(e => e.sourceEpisodeId))}>全选剧集</button><button className="text-action" type="button" onClick={() => setEpisodeIds([])}>取消全选</button>
        {material.episodes.map(episode => <label key={episode.sourceEpisodeId}><input type="checkbox" checked={episodeIds.includes(episode.sourceEpisodeId)} onChange={event => setEpisodeIds(ids => event.target.checked ? [...ids, episode.sourceEpisodeId] : ids.filter(id => id !== episode.sourceEpisodeId))} />第 {episode.episodeNumber} 集 · {episode.title}{scriptWorkflow === false ? `（${episode.shots?.length ?? 0} 镜）` : ""}</label>)}
      </div>
      {scriptWorkflow === false && !!material.assets.length && <details><summary>查看读取的资产</summary><ul>{material.assets.map(asset => <li key={asset.sourceAssetId}>{({ character: "人物", scene: "场景", prop: "道具", costume: "服装" })[asset.kind]} · {asset.name}</li>)}</ul></details>}
      </>}
      {!!material.warnings.length && <details open><summary>需要注意</summary><ul>{material.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {embedded ? <div className="host-sync-confirmation">
        {hasContent && <><p>本次同步 <strong>{scriptWorkflow ? `${selectedEpisodeCount} 集正文` : `${selectedEpisodeCount} 集正文 · ${selectedShotCount} 个镜头 · ${selectedAssetCount} 项资产`}</strong></p><small>{scriptWorkflow ? storyboardConflict ? "先保存旧版，再更新分镜。完成后进入分镜页面核对修订结果。" : "确认后更新当前项目中对应的剧本内容，并进入资产设计。未保存的修改不会同步。" : "重复同步会更新对应内容，已定稿资产保留；不会自动生成图片或视频。"}</small></>}
        <div className="host-sync-actions"><button className="outline-action" onClick={onClose} type="button">继续创作</button><button className="primary-action" disabled={scriptWorkflow === null || !target || (!episodeIds.length && !(!scriptWorkflow && includeAssets && material.assets.length))} onClick={() => void submit(scriptWorkflow && storyboardConflict ? "preserve-history" : undefined)} type="button">{busy ? "正在同步…" : scriptWorkflow && storyboardConflict ? "保存修订并更新分镜" : scriptWorkflow ? "同步剧本并进入资产设计" : "确认同步所选内容"}</button></div>
      </div> : <><p>重复导入会复用来源记录；已定稿资产保留。来源中删除的条目不会删除主项目内容。</p>
      <button className="primary-action" disabled={!target || (!episodeIds.length && !(includeAssets && material.assets.length))} onClick={() => void submit(scriptWorkflow && storyboardConflict ? "preserve-history" : undefined)} type="button">{scriptWorkflow && storyboardConflict ? "保存修订并更新分镜" : "确认导入所选内容"}</button></>}
    </fieldset>}
    {receipt && <><p className="inline-notice" role="status" ref={receiptElement}>{scriptWorkflow ? `剧本已同步：新增 ${receipt.importedEpisodes} 集、更新 ${receipt.updatedEpisodes} 集。` : `${embedded ? "同步完成" : "导入完成"}：新增 ${receipt.importedEpisodes} 集、更新 ${receipt.updatedEpisodes} 集；新增 ${receipt.importedShots} 镜、更新 ${receipt.updatedShots} 镜；新增 ${receipt.importedAssets} 项资产、更新 ${receipt.updatedAssets} 项、保留 ${receipt.preservedAssets} 项定稿资产。`}{scriptWorkflow === false && <HostWorkspaceLink className="host-return-link" projectId={receipt.targetProjectId}>查看制作稿</HostWorkspaceLink>}</p>
      {receipt.warnings?.map((warning, index) => <p className="inline-notice" role="status" key={index}>{warning}</p>)}
      {receipt.revisionSummary && <p className="inline-notice" role="status">已保存第 {receipt.revisionSummary.episodeNumbers.join("、")} 集的旧版正文与分镜；复用 {receipt.revisionSummary.preservedShots} 个镜头，更新 {receipt.revisionSummary.renewedShots} 个镜头。可在分镜页的「制作修订历史」查看旧版。</p>}
      <div className="host-import-next">{receipt.revisionSummary ? <><HostWorkspaceLink className="primary-action" projectId={receipt.targetProjectId} view="storyboard">查看修订后的分镜</HostWorkspaceLink><HostWorkspaceLink className="outline-action" projectId={receipt.targetProjectId} view="assets">检查资产设计</HostWorkspaceLink></> : <><HostWorkspaceLink className="primary-action" projectId={receipt.targetProjectId} view="assets">进入资产设计</HostWorkspaceLink>{scriptWorkflow === false && <HostWorkspaceLink className="outline-action" projectId={receipt.targetProjectId} view="storyboard">进入分镜制作</HostWorkspaceLink>}</>}</div></>}
  </dialog>;
}
