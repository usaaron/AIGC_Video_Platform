"use client";

import Link from "next/link";
import { Check, LockKeyhole } from "lucide-react";
import { useState } from "react";
import type { ScriptProject } from "@/lib/types";
import { workspaceSectionAccess, workspaceSectionHref, type WorkspaceSectionId } from "@/lib/workspace-stage";
import { isQuickScriptProject, projectSourceHref, quickScriptHref } from "@/lib/quick-script-project";

/** Stage links only navigate. Approval and generation stay with the document. */
export function HostScriptStages({ project, section, inputPage }: {
  project: ScriptProject;
  section: WorkspaceSectionId;
  inputPage: boolean;
}) {
  const [hint, setHint] = useState("");
  const quick = isQuickScriptProject(project);
  const access = workspaceSectionAccess(project, { scriptWorkflow: true });
  const story = inputPage || section === "story-synopsis" || section === "story-bible";
  const stages = quick ? [
    { id: "story", label: "故事梗概", active: true, allowed: true,
      href: inputPage ? projectSourceHref(project.id) : quickScriptHref(project.id),
      completed: Boolean(project.quickWorkflow?.synopsis_confirmed), hint: "" },
    { id: "planning", label: "创作安排", active: false, allowed: Boolean(project.quickWorkflow?.synopsis_confirmed),
      href: quickScriptHref(project.id), completed: Boolean(project.quickWorkflow?.plan_confirmed),
      hint: "先提供原始资料并确认故事梗概，再核对人物和每集故事。" },
    { id: "script", label: "剧本正文", active: false, allowed: Boolean(project.quickWorkflow?.plan_confirmed),
      href: quickScriptHref(project.id), completed: false,
      hint: "先确认创作安排，再生成剧本正文。" },
  ] : [
    { id: "story", label: "故事设定", active: story, allowed: true,
      href: inputPage ? `/projects/${project.id}` : workspaceSectionHref(project, story ? section : access.storyBible ? "story-bible" : "story-synopsis"),
      completed: project.storyBibleStatus === "approved", hint: "" },
    { id: "planning", label: "分集大纲", active: section === "planning" && !inputPage, allowed: access.planning,
      href: workspaceSectionHref(project, "planning"), completed: access.script,
      hint: "先在故事设定中确认梗概及人物与世界观，再开始安排每集故事。" },
    { id: "script", label: "剧本正文", active: section === "script" && !inputPage, allowed: access.script,
      href: workspaceSectionHref(project, "script"), completed: false,
      hint: "先完成分集大纲的检查和确认，再进入正文创作。" },
  ];
  const parts = quick ? [
    { label: "原始资料", href: projectSourceHref(project.id), active: inputPage, allowed: true },
    { label: "故事梗概", href: quickScriptHref(project.id), active: !inputPage, allowed: true },
  ] : [
    { label: "原始资料", href: `/projects/${project.id}`, active: inputPage, allowed: true },
    { label: "故事梗概", href: workspaceSectionHref(project, "story-synopsis"), active: !inputPage && section === "story-synopsis", allowed: true },
    { label: "人物与世界观", href: workspaceSectionHref(project, "story-bible"), active: !inputPage && section === "story-bible", allowed: access.storyBible },
  ];
  return <div className="host-script-stages">
    <nav aria-label="剧本阶段" className="host-stage-navigation">
      {stages.map((stage, index) => stage.allowed
        ? <Link key={stage.id} href={stage.href} aria-current={stage.active ? "step" : undefined} onClick={() => setHint("")}>
          <span className="host-stage-number">{stage.completed ? <Check size={13} aria-label="已完成" /> : `0${index + 1}`}</span>{stage.label}
        </Link>
        : <button key={stage.id} type="button" aria-disabled="true" onClick={() => setHint(stage.hint)}>
          <span className="host-stage-number">0{index + 1}</span>{stage.label}<LockKeyhole size={12} aria-hidden="true" />
        </button>)}
    </nav>
    {story && <nav aria-label="故事设定内容" className="host-story-navigation">
      {parts.map(part => part.allowed
        ? <Link key={part.label} href={part.href} aria-current={part.active ? "page" : undefined} onClick={() => setHint("")}>{part.label}</Link>
        : <button key={part.label} type="button" aria-disabled="true" onClick={() => setHint("先确认故事梗概，再展开人物、世界观与完整故事设定。")}>{part.label}<LockKeyhole size={11} aria-hidden="true" /></button>)}
    </nav>}
    {hint && <p className="host-stage-hint" role="status">{hint}</p>}
  </div>;
}
