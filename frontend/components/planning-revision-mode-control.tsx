"use client";

import type { PlanningRevisionMode } from "@/lib/story-planning-client";
import { useLocale } from "@/providers/locale-provider";

export function PlanningRevisionModeControl({ disabled, onChange, value }: {
  disabled?: boolean;
  onChange: (value: PlanningRevisionMode) => void;
  value: PlanningRevisionMode;
}) {
  const { t } = useLocale();

  return (
    <div aria-label={t("planningRevision.modeLabel")} className="planning-revision-modes" role="group">
      <button
        aria-pressed={value === "targeted"}
        className={value === "targeted" ? "is-selected" : undefined}
        disabled={disabled}
        onClick={() => onChange("targeted")}
        type="button"
      >
        <strong>{t("planningRevision.targeted")}</strong>
        <span>{t("planningRevision.targetedHelp")}</span>
      </button>
      <button
        aria-pressed={value === "rewrite"}
        className={value === "rewrite" ? "is-selected" : undefined}
        disabled={disabled}
        onClick={() => onChange("rewrite")}
        type="button"
      >
        <strong>{t("planningRevision.rewrite")}</strong>
        <span>{t("planningRevision.rewriteHelp")}</span>
      </button>
    </div>
  );
}
