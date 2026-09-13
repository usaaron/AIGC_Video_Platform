import type { CreatorTag } from "@/lib/types";

export function TagChoice({ tag, label, selected, disabled, onToggle, description }: {
  tag: CreatorTag; label: string; selected: boolean; disabled: boolean;
  onToggle: (tag: CreatorTag) => void; description?: string;
}) {
  return <label className={"creator-tag-choice" + (selected ? " is-selected" : "")} title={description || undefined}>
    <input type="checkbox" checked={selected} disabled={disabled} onChange={() => onToggle(tag)} />
    <span>{label}</span>
  </label>;
}
