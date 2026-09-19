"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, RefreshCw } from "lucide-react";
import { analyzeInputReadiness } from "@/lib/input-readiness-client";
import { groupInputSourceFacts, verifiedInputFacts } from "@/lib/input-readiness";
import { userFacingError } from "@/lib/api-error";
import type { InputReadinessAnalysis, InputSourceFact, ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

export function InputSourceFacts({ facts }: { facts: InputSourceFact[] }) {
  const { t } = useLocale();
  const groups = groupInputSourceFacts(facts);
  const singleSource = new Set(facts.map((fact) => fact.sourceId)).size === 1;
  return <div className="input-source-facts">
    {singleSource && <p className="input-source-origin"><FileText aria-hidden="true" size={13} />{facts[0].sourceName}</p>}
    {groups.map((group) => (
      <details key={group.field}>
        <summary><span><ChevronRight aria-hidden="true" className="input-source-disclosure" size={14} />{t(`inputReadiness.fact.${group.field}`)}</span></summary>
        {group.sources.map((source) => <div className="input-source-quotes" key={source.sourceId}>
          {!singleSource && <p className="input-source-origin"><FileText aria-hidden="true" size={13} />{source.sourceName}</p>}
          {source.facts.map((fact) => <blockquote key={fact.quote}>{fact.quote}</blockquote>)}
        </div>)}
      </details>
    ))}
  </div>;
}

export function ProjectSourceFacts({ project, onAnalysis }: {
  project: ScriptProject;
  onAnalysis?: (analysis: InputReadinessAnalysis) => void;
}) {
  const { t } = useLocale();
  const [analysis, setAnalysis] = useState(project.inputReadiness);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const projectRef = useRef(project);
  const onAnalysisRef = useRef(onAnalysis);
  projectRef.current = project;
  onAnalysisRef.current = onAnalysis;
  const sourceKey = JSON.stringify([project.id, project.creativePrompt,
    project.referenceMaterials.map((item) => [item.fileName, item.extractedText]), project.generationSettings.episodeCount]);
  useEffect(() => {
    const source = projectRef.current;
    const controller = new AbortController();
    const cached = source.inputReadiness;
    setError(null);
    setLoading(false);
    if (!retry && cached?.assessmentVersion === 2
      && verifiedInputFacts(cached, source).length === cached.knownFacts?.length) {
      setAnalysis(cached);
      onAnalysisRef.current?.(cached);
      return;
    }
    setAnalysis(undefined);
    if (!source.creativePrompt.trim() && !source.referenceMaterials.length) return;
    setLoading(true);
    // Legacy projects can inspect source facts without modifying their saved session.
    void analyzeInputReadiness(source, { useModel: false, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setAnalysis(result);
        onAnalysisRef.current?.(result);
      }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(userFacingError(reason, t("inputReadiness.failed")));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sourceKey, retry, t]);
  const facts = verifiedInputFacts(analysis, project);
  if (!facts.length && !error && !loading) return null;
  return <section className="input-readiness-facts">
    <h4>{t("inputReadiness.existingFacts")}</h4>
    <InputSourceFacts facts={facts} />
    {loading && <p role="status">{t("inputReadiness.analyzing")}</p>}
    {error && <div className="inline-notice is-error" role="alert">{error}
      <button className="outline-action" onClick={() => setRetry((value) => value + 1)} type="button">
        <RefreshCw size={14} />{t("inputReadiness.retry")}
      </button>
    </div>}
  </section>;
}

export function InputReadinessReview({ analysis, compact = false }: { analysis: InputReadinessAnalysis; compact?: boolean }) {
  const { t } = useLocale();
  const audit = analysis.episodeAudit;
  const facts = analysis.knownFacts ?? [];
  const categoryCount = groupInputSourceFacts(facts).length;
  const hasNumberedInput = Boolean(audit?.suppliedNumbers.length || audit?.outOfRangeNumbers.length);
  const actionableMissingItems = compact
    ? analysis.missingItems.filter((item) => !/生成并检查完整分集规划|待整理.*完整总纲结构/.test(item))
    : analysis.missingItems;
  return <section className={`input-readiness-panel${compact ? " is-compact" : ""}`} aria-live="polite">
    {!compact && <span className="section-kicker">{t("inputReadiness.title")}</span>}
    <h3>{t(compact ? "inputReadiness.compactTitle" : `inputReadiness.level.${analysis.detectedLevel}`)}</h3>
    {analysis.analysisNotice && <p className="inline-notice" role="status">{analysis.analysisNotice}</p>}
    {!compact && <div className="input-readiness-next"><span>{t("inputReadiness.nextAction")}</span>
      <strong>{t("inputReadiness.fullWorkflow")}</strong>
    </div>}
    {facts.length > 0 && <details className="input-readiness-facts" open={compact ? undefined : true}>
      <summary>{t(compact ? "inputReadiness.compactFacts" : "inputReadiness.existingFacts")}{t("inputReadiness.factCategoryCount").replace("{count}", String(categoryCount))}</summary><InputSourceFacts facts={facts} />
    </details>}
    {hasNumberedInput && audit && <dl className="input-readiness-audit">
      <div><dt>{t("inputReadiness.targetEpisodes")}</dt><dd>{audit.targetCount}</dd></div>
      <div><dt>{t("inputReadiness.suppliedEpisodes")}</dt><dd>{audit.suppliedNumbers.length}</dd></div>
      <div><dt>{t(analysis.detectedLevel === "script" ? "inputReadiness.scriptEpisodes" : "inputReadiness.plannedEpisodes")}</dt>
        <dd>{analysis.detectedLevel === "script" ? audit.scriptNumbers.length : audit.completePlanNumbers.length}</dd></div>
    </dl>}
    {(!compact || actionableMissingItems.length > 0) && <div className="input-readiness-missing"><h4>{t(compact ? "inputReadiness.compactMissing" : "inputReadiness.missing")}</h4>
      {actionableMissingItems.length ? <ul>{actionableMissingItems.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p>{t("inputReadiness.reviewStillRequired")}</p>}
    </div>}
    {!compact && <ol className="input-readiness-path" aria-label={t("inputReadiness.reviewPath")}>
      <li>{t("inputReadiness.preserveSource")}</li><li>{t("inputReadiness.reviewSynopsis")}</li><li>{t("inputReadiness.reviewBible")}</li>
      <li>{t("inputReadiness.reviewPlanning")}</li><li>{t("inputReadiness.stage.script")}</li>
    </ol>}
  </section>;
}
