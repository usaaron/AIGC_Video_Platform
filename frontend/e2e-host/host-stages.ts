import { expect, type FrameLocator } from "@playwright/test";

export async function navigateScriptStage(frame: FrameLocator, destination: string) {
  const stages = frame.getByRole("navigation", { name: "剧本阶段", exact: true });
  await expect(stages).toBeVisible();
  const storyParts: Record<string, string> = { "故事输入": "原始资料", "故事梗概": "故事梗概", "故事总纲": "人物与世界观" };
  const storyPart = storyParts[destination];
  const stage = storyPart ? "故事设定" : destination === "全剧规划" ? "分集大纲" : "剧本正文";
  const stageLink = stages.getByRole("link", { name: new RegExp(`${stage}$`) });
  if (await stageLink.getAttribute("aria-current") !== "step") await stageLink.click();
  await expect(stageLink).toHaveAttribute("aria-current", "step");
  if (storyPart) {
    const part = frame.getByRole("navigation", { name: "故事设定内容", exact: true }).getByRole("link", { name: storyPart, exact: true });
    if (await part.getAttribute("aria-current") !== "page") await part.click();
    await expect(part).toHaveAttribute("aria-current", "page");
  }
  await expect(frame.locator("#host-workflow-directory")).toBeHidden();
}
