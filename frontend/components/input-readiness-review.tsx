"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, RefreshCw } from "lucide-react";
import { analyzeInputReadiness } from "@/lib/input-readiness-client";
import { verifiedInputFacts } from "@/lib/input-readiness";
import { userFacingError } from "@/lib/api-error";
import type { InputReadinessAnalysis, InputSourceFact, ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

export function InputSourceFacts({ facts }: { facts: InputSourceFact[] }) {
  const { t } = useLocale();
  return <div className="input-source-facts">{facts.map((fact, index) => (
    <details key={`${fact.sourceId}:${fact.field}:${fact.start}:${index}`}>
      <summary><span><ChevronRight aria-hidden="true" className="input-source-disclosure" size={14} />{t(`inputReadiness.fact.${fact.field}`)}</span><small><FileText size={13} />{fact.sourceName}</small></summary>
      <blockquote>{fact.quote}</blockquote>
    </details>
  ))}</div>;
}

export function ProjectSourceFacts({ project, onAnalysis }: {
  project: ScriptProject;
  onAnalysis?: (analysis: InputReadinessAnalysis) => void;
}) {
  const { t } = useLocale();
  const [analysis, setAnalysis] = useState(project.inputReadiness);
  const [error, setError] = useState<string | null>(null);
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
    if (!retry && cached?.assessmentVersion === 2
      && verifiedInputFacts(cached, source).length === cached.knownFacts?.length) {
      setAnalysis(cached);
      onAnalysisRef.current?.(cached);
      return;
    }
    setAnalysis(undefined);
    setError(null);
    if (!source.creativePrompt.trim() && !source.referenceMaterials.length) return;
    // Legacy projects can inspect source facts without modifying their saved session.
    void analyzeInputReadiness(source, { useModel: false, signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setAnalysis(result);
        onAnalysisRef.current?.(result);
      }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(userFacingError(reason, t("inputReadiness.failed")));
    });
    return () => controller.abort();
  }, [sourceKey, retry, t]);
  const facts = verifiedInputFacts(analysis, project);
  if (!facts.length && !error) return null;
  return <section className="input-readiness-facts">
    <h4>{t("inputReadiness.existingFacts")}</h4>
    <InputSourceFacts facts={facts} />
    {error && <div className="inline-notice" role="status">{error}
      <button className="outline-action" onClick={() => setRetry((value) => value + 1)} type="button">
        <RefreshCw size={14} />{t("inputReadiness.retry")}
      </button>
    </div>}
  </section>;
}

export function InputReadinessReview({ analysis }: { analysis: InputReadinessAnalysis }) {
  const { t } = useLocale();
  const audit = analysis.episodeAudit;
  const facts = analysis.knownFacts ?? [];
  const hasNumberedInput = Boolean(audit?.suppliedNumbers.length || audit?.outOfRangeNumbers.length);
  return <section className="input-readiness-panel" aria-live="polite">
    <span className="section-kicker">{t("inputReadiness.title")}</span>
    <h3>{t(`inputReadiness.level.${analysis.detectedLevel}`)}</h3>
    {analysis.analysisNotice && <p className="inline-notice" role="status">{analysis.analysisNotice}</p>}
    <div className="input-readiness-next"><span>{t("inputReadiness.nextAction")}</span>
      <strong>{t(analysis.detectedLevel === "premise" ? "inputReadiness.nextDevelop" : "inputReadiness.nextReview")}</strong>
    </div>
    {facts.length > 0 && <div className="input-readiness-facts">
      <h4>{t("inputReadiness.existingFacts")}</h4><InputSourceFacts facts={facts} />
    </div>}
    {hasNumberedInput && audit && <dl className="input-readiness-audit">
      <div><dt>{t("inputReadiness.targetEpisodes")}</dt><dd>{audit.targetCount}</dd></div>
      <div><dt>{t("inputReadiness.suppliedEpisodes")}</dt><dd>{audit.suppliedNumbers.length}</dd></div>
      <div><dt>{t(analysis.detectedLevel === "script" ? "inputReadiness.scriptEpisodes" : "inputReadiness.plannedEpisodes")}</dt>
        <dd>{analysis.detectedLevel === "script" ? audit.scriptNumbers.length : audit.completePlanNumbers.length}</dd></div>
    </dl>}
    <div className="input-readiness-missing"><h4>{t("inputReadiness.missing")}</h4>
      {analysis.missingItems.length ? <ul>{analysis.missingItems.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p>{t("inputReadiness.reviewStillRequired")}</p>}
    </div>
    {analysis.detectedLevel !== "premise" && <ol className="input-readiness-path" aria-label={t("inputReadiness.reviewPath")}>
      <li>{t("inputReadiness.preserveSource")}</li><li>{t("inputReadiness.reviewBible")}</li>
      <li>{t("inputReadiness.reviewPlanning")}</li><li>{t("inputReadiness.stage.script")}</li>
    </ol>}
  </section>;
}
