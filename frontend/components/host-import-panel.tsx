"use client";

import { useEffect, useRef, useState } from "react";
import { hostProjectId } from "@/lib/host-session";
import { isHostEmbedded, notifyHost } from "@/lib/host-navigation";
import { HostWorkspaceLink } from "@/components/host-return-link";
import { importMaterial, loadImportTargets, readImportMaterial, type ImportReceipt } from "@/lib/host-import";
import type { ImportMaterial } from "@/lib/host-import-payload";
import type { ScriptProject } from "@/lib/types";

export function HostImportPanel({ project, onTarget, onClose }: { project: ScriptProject; onTarget: (id: string) => void; onClose: () => void }) {
  const [targets, setTargets] = useState<Array<{ id: string; name: string }>>([]);
  const [target, setTarget] = useState(hostProjectId() ?? project.hostDeliveryTargetProjectId ?? "");
  const [material, setMaterial] = useState<ImportMaterial | null>(null);
  const [episodeIds, setEpisodeIds] = useState<string[]>([]);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [includeShots, setIncludeShots] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const receiptElement = useRef<HTMLParagraphElement>(null);
  const current = useRef(project);
  current.current = project;
  const loadedAt = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (receipt) receiptElement.current?.scrollIntoView({ block: "nearest" }); }, [receipt]);
  async function read() {
    if (busy) return;
    setBusy(true); setError(""); setReceipt(null); setMaterial(null);
    const snapshot = current.current;
    try {
      const [available, result] = await Promise.all([loadImportTargets(), readImportMaterial(snapshot)]);
      if (!mounted.current) return;
      if (snapshot.updatedAt !== current.current.updatedAt) throw new Error("读取期间剧本内容发生变化，请重新读取。");
      const scopedId = isHostEmbedded() ? hostProjectId() : null;
      const allowed = scopedId ? available.filter(item => item.id === scopedId) : available;
      setTargets(allowed); setMaterial(result); setEpisodeIds(result.episodes.map(e => e.sourceEpisodeId));
      loadedAt.current = snapshot.updatedAt;
      setTarget(value => allowed.some(p => p.id === value) ? value : allowed.length === 1 ? allowed[0].id : "");
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "读取失败，请重试。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function submit() {
    if (!material || busy || !target) return;
    if (loadedAt.current !== current.current.updatedAt) { setError("剧本已修改，请重新读取后导入。"); return; }
    setBusy(true); setError(""); setReceipt(null);
    try {
      const result = await importMaterial(current.current, target, material, { episodeIds, assets: includeAssets, shots: includeShots });
      if (!mounted.current) return;
      setReceipt(result); onTarget(target);
      notifyHost("synced", result.targetProjectId);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "导入失败，已保存内容保留，请重试。"); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <dialog className="host-import-dialog" ref={dialog} aria-labelledby="host-import-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h3 id="host-import-title">批量导入主项目</h3><p>读取已保存正文、分镜和人物／场景／道具资料。</p></div><button aria-label="关闭批量导入" className="outline-action" disabled={busy} onClick={onClose} type="button">关闭</button></header>
    <p>{hostProjectId() ? "当前创作已绑定主项目，确认范围后同步到该项目。" : "导入后在主项目的剧本、资产设计和分镜中继续制作。"}不会自动生成图片、视频或扣积分。</p>
    <button className="outline-action" disabled={busy} onClick={() => void read()} type="button">{busy ? "正在处理…" : material ? "重新读取分镜与资产" : "读取分镜与资产"}</button>
    {error && <p className="inline-notice is-error" role="alert">{error}</p>}
    {material && <fieldset disabled={busy}><legend>导入范围</legend>
      <label className="host-import-target">目标主项目<select value={target} onChange={event => setTarget(event.target.value)}><option value="">请选择主项目</option>{targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!targets.length && <p role="status">没有可写入的网剧项目，请先在主站项目库新建网剧项目，再重新读取。</p>}
      <p>已读取 {material.episodes.length} 集 · {material.episodes.reduce((sum, e) => sum + (e.shots?.length ?? 0), 0)} 个镜头 · {material.assets.length} 项资产</p>
      <label><input type="checkbox" checked={includeShots} onChange={event => setIncludeShots(event.target.checked)} />同时导入所选剧集的已保存分镜</label>
      <label><input type="checkbox" checked={includeAssets} onChange={event => setIncludeAssets(event.target.checked)} />读取的全部资产（跨集同名同类合并）</label>
      <div className="host-import-episodes"><button className="text-action" type="button" onClick={() => setEpisodeIds(material.episodes.map(e => e.sourceEpisodeId))}>全选剧集</button><button className="text-action" type="button" onClick={() => setEpisodeIds([])}>取消全选</button>
        {material.episodes.map(episode => <label key={episode.sourceEpisodeId}><input type="checkbox" checked={episodeIds.includes(episode.sourceEpisodeId)} onChange={event => setEpisodeIds(ids => event.target.checked ? [...ids, episode.sourceEpisodeId] : ids.filter(id => id !== episode.sourceEpisodeId))} />第 {episode.episodeNumber} 集 · {episode.title}（{episode.shots?.length ?? 0} 镜）</label>)}
      </div>
      {!!material.assets.length && <details><summary>查看读取的资产</summary><ul>{material.assets.map(asset => <li key={asset.sourceAssetId}>{({ character: "人物", scene: "场景", prop: "道具", costume: "服装" })[asset.kind]} · {asset.name}</li>)}</ul></details>}
      {!!material.warnings.length && <details open><summary>需要注意</summary><ul>{material.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      <p>重复导入会复用来源记录；已定稿资产保留。来源中删除的条目不会删除主项目内容。</p>
      <button className="primary-action" disabled={!target || (!episodeIds.length && !(includeAssets && material.assets.length))} onClick={() => void submit()} type="button">确认导入所选内容</button>
    </fieldset>}
    {receipt && <><p className="inline-notice" role="status" ref={receiptElement}>导入完成：新增 {receipt.importedEpisodes} 集、更新 {receipt.updatedEpisodes} 集；新增 {receipt.importedShots} 镜、更新 {receipt.updatedShots} 镜；新增 {receipt.importedAssets} 项资产、更新 {receipt.updatedAssets} 项、保留 {receipt.preservedAssets} 项定稿资产。<HostWorkspaceLink className="host-return-link" projectId={receipt.targetProjectId}>查看制作稿</HostWorkspaceLink></p>
      <div className="host-import-next"><HostWorkspaceLink className="primary-action" projectId={receipt.targetProjectId} view="assets">进入资产设计</HostWorkspaceLink><HostWorkspaceLink className="outline-action" projectId={receipt.targetProjectId} view="storyboard">进入分镜制作</HostWorkspaceLink></div></>}
  </dialog>;
}
