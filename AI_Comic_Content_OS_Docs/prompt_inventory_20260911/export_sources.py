"""Export selected prompt definitions without importing or executing application code."""

from __future__ import annotations

import ast
import hashlib
import json
from datetime import datetime
from pathlib import Path


INVENTORY = Path(__file__).resolve().parent
ROOT = INVENTORY.parents[1]


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def definitions(tree: ast.AST, prefix: str = "") -> dict[str, ast.AST]:
    result = {}
    for node in getattr(tree, "body", []):
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            name = prefix + node.name
            result[name] = node
            result.update(definitions(node, name + "."))
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    result[prefix + target.id] = node
    return result


def template_text(node: ast.AST) -> str:
    if isinstance(node, ast.Constant):
        return str(node.value)
    if isinstance(node, ast.JoinedStr):
        return "".join(template_text(part) for part in node.values)
    if isinstance(node, ast.FormattedValue):
        conversion = "!" + chr(node.conversion) if node.conversion != -1 else ""
        format_spec = ":" + template_text(node.format_spec) if node.format_spec else ""
        return "{" + ast.unparse(node.value) + conversion + format_spec + "}"
    raise TypeError(type(node).__name__)


def reading_blocks(node: ast.AST) -> list[tuple[int, str]]:
    blocks = []

    def visit(current: ast.AST) -> None:
        if isinstance(current, ast.JoinedStr) or (
            isinstance(current, ast.Constant) and isinstance(current.value, str)
        ):
            value = template_text(current)
            if len(value.strip()) >= 30 or "\n" in value.strip():
                blocks.append((current.lineno, value))
            return
        children = list(ast.iter_child_nodes(current))
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if current.body and isinstance(current.body[0], ast.Expr):
                first = current.body[0]
                if isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                    children = [child for child in children if child is not first]
        for child in children:
            visit(child)

    visit(node)
    return sorted(blocks, key=lambda block: block[0])


def fence(value: str, language: str) -> str:
    marker = "`" * max(4, max((len(part) for part in value.splitlines() if part and set(part) == {"`"}), default=0) + 1)
    return f"{marker}{language}\n{value.rstrip()}\n{marker}\n"


def main() -> None:
    manifests = sorted(INVENTORY.glob("[0-9][0-9]-extract.json"))
    if len(manifests) != 4:
        raise ValueError(f"Expected four reviewed extraction manifests, got {len(manifests)}")
    output = INVENTORY / "sources"
    output.mkdir(exist_ok=True)
    cache: dict[str, str] = {}
    parsed: dict[str, dict[str, ast.AST]] = {}
    records = []
    seen = set()
    for manifest in manifests:
        entries = json.loads(manifest.read_text(encoding="utf-8"))
        for item in entries:
            item_id = item["id"]
            if item_id in seen or not all(ch.isalnum() or ch in "-_." for ch in item_id):
                raise ValueError(f"Invalid or duplicate source ID: {item_id}")
            seen.add(item_id)
            relative = item["path"]
            path = (ROOT / relative).resolve()
            if not path.is_relative_to(ROOT) or ".env" in path.name:
                raise ValueError(f"Source path outside inventory scope: {relative}")
            if relative not in cache:
                cache[relative] = path.read_text(encoding="utf-8")
            text = cache[relative]
            lines = text.splitlines(keepends=True)
            node = None
            if item.get("symbol"):
                if relative not in parsed:
                    parsed[relative] = definitions(ast.parse(text))
                node = parsed[relative][item["symbol"]]
                start = node.lineno
                decorators = getattr(node, "decorator_list", [])
                if decorators:
                    start = min(start, *(decorator.lineno for decorator in decorators))
                end = node.end_lineno
            else:
                start = item.get("start_line", 1)
                end = item.get("end_line", len(lines))
            if not 1 <= start <= end <= len(lines):
                raise ValueError(f"Invalid source span for {item_id}: {start}-{end}")
            source = "".join(lines[start - 1:end])
            source_hash = digest(source)
            record = {
                **item,
                "manifest": manifest.name,
                "start_line": start,
                "end_line": end,
                "source_sha256": digest(text),
                "excerpt_sha256": source_hash,
                "artifact": f"sources/{item_id}.md",
            }
            records.append(record)
            parts = [
                f"# {item['title']}\n",
                f"编号：`{item_id}`。状态：`{item['status']}`。\n",
                f"来源：[{relative}:{start}]({path}:{start})。符号：`{item.get('symbol', '指定原文片段')}`。\n",
                str(item.get("notes", "")) + "\n",
                "本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。\n",
            ]
            if node is not None:
                blocks = reading_blocks(node)
                if blocks:
                    parts.extend([
                        "## 长文本阅读视图\n",
                        "按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。\n",
                    ])
                    for index, (line, value) in enumerate(blocks, 1):
                        parts.extend([f"### 片段 {index} · 源码第 {line} 行\n", fence(value, "text")])
            parts.extend([
                "## 源码原文\n",
                "此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。\n",
                fence(source, "python" if path.suffix == ".py" else "json" if path.suffix == ".json" else "text"),
                f"片段 SHA-256：`{source_hash}`\n",
            ])
            rendered = "\n".join(parts)
            if source.rstrip() not in rendered:
                raise AssertionError(f"Verbatim source lost: {item_id}")
            (output / f"{item_id}.md").write_text(rendered, encoding="utf-8")

    for relative, initial in cache.items():
        if (ROOT / relative).read_text(encoding="utf-8") != initial:
            raise RuntimeError(f"Source changed during extraction; rerun for a consistent snapshot: {relative}")

    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    provenance = {
        "generated_at": stamp,
        "scope": "current working-tree source; no application imports, runtime calls, or database reads",
        "entry_count": len(records),
        "source_file_count": len(cache),
        "entries": records,
    }
    (INVENTORY / "source-provenance.json").write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    index = [
        "# 提示词原文索引\n",
        f"提取时间：{stamp}。共 {len(records)} 个定义或原文片段，来自 {len(cache)} 个源码文件。\n",
        "每项均包含来源、适用状态、可提取的长文本阅读视图及完整源码原文。这里的条目数不等于运行时模型调用次数。\n",
        "[返回中文总览](README.md)\n",
        "| 编号 | 原文 | 状态 | 来源 |\n| --- | --- | --- | --- |",
    ]
    for record in records:
        index.append(f"| `{record['id']}` | [{record['title']}]({record['artifact']}) | {record['status']} | `{record['path']}:{record['start_line']}` |")
    (INVENTORY / "原文索引.md").write_text("\n".join(index) + "\n", encoding="utf-8")
    print(json.dumps({"entries": len(records), "source_files": len(cache), "generated_at": stamp}, ensure_ascii=False))


if __name__ == "__main__":
    main()
