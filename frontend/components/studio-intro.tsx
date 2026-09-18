"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import { useLocale } from "@/providers/locale-provider";

export function StudioIntro() {
  const { locale } = useLocale();
  const english = locale.startsWith("en");
  return <section className="studio-intro" aria-label={english ? "Your writing studio" : "你的长篇故事工作台"}>
    <div className="studio-intro-copy">
      <span className="studio-eyebrow"><Sparkles size={14} /> {english ? "SEQORA / THE WRITING ROOM" : "序幕 · 剧本大师"}</span>
      <h1>{english ? "A little inspiration." : "一点灵感，"}<br /><em>{english ? "An entire new world." : "一个全新的世界。"}</em></h1>
      <p>{english ? "Shape your idea, build your world and write your next series, one episode at a time." : "从故事想法，到世界观、分集规划与每一集剧本。一步一步，让故事有迹可循。"}</p>
      <Link href="/projects/new" className="primary-action">{english ? "Start a new story" : "开始新的故事"}<ArrowRight size={16} /></Link>
    </div>
    <div className="studio-manuscript" aria-hidden="true">
      <div className="studio-manuscript-glow" />
      {[0, 1, 2].map(index => <div key={index} className="studio-manuscript-sheet" style={{ "--sheet": index } as CSSProperties}>
        <span>SEQORA / ORIGINALS</span><strong>{['THE IDEA', 'THE WORLD', 'THE STORY'][index]}</strong>
        <i /><i /><i /><i /><small>CHAPTER {String(index + 1).padStart(2, '0')}</small>
      </div>)}
    </div>
  </section>;
}
