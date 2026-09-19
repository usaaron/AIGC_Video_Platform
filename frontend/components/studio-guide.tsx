"use client";

import { Compass } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocale } from "@/providers/locale-provider";

export function StudioGuide() {
  const guide = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      const panel = guide.current;
      if (!panel?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        panel.open = false;
        panel.querySelector("summary")?.focus();
      } else if (!panel.contains(event.target as Node)) panel.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  const { locale } = useLocale();
  const english = locale.startsWith("en");
  const steps = english ? [
    ["Start with your idea", "Create a project. Add your story idea, source material and preferred style."],
    ["Shape the story", "Confirm the synopsis, then review the Story Bible and character settings before planning the series."],
    ["Plan the episodes", "Review the story structure and episode plan, then generate individual scripts."],
    ["Review and hand off", "Save and review the script and storyboard, then export or send them to the main workspace."],
  ] : [
    ["先说清楚你的想法", "新建剧本，填写创作想法、参考资料和希望的风格。"],
    ["梗概定方向，总纲建世界", "先确认故事梗概，再检查总纲与人物设定，进入全剧规划。"],
    ["从整部剧，到每一集", "检查故事结构与分集计划，然后按集生成正文。"],
    ["检查、保存，再交接", "确认剧本与分镜后导出，或交接到主站继续制作。"],
  ];
  return <details className="studio-help" ref={guide}>
    <summary aria-label={english ? "Getting started" : "创作指引"}><Compass size={16} /><span>{english ? "Getting started" : "创作指引"}</span></summary>
    <div className="studio-help-panel">
      <h2>{english ? "One story. A clear path." : "一个故事，一条清晰的路径。"}</h2>
      {steps.map(([title, detail], index) => <div key={title}><b>0{index + 1}</b><span><strong>{title}</strong><small>{detail}</small></span></div>)}
    </div>
  </details>;
}
