from __future__ import annotations

import base64
import binascii
from io import BytesIO
from pathlib import PurePath
import re
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from pydantic import BaseModel, ConfigDict, Field


MAX_ATTACHMENT_COUNT = 8
MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024
MAX_ATTACHMENT_CHARACTERS = 30_000
MAX_TOTAL_INPUT_CHARACTERS = 120_000
SUPPORTED_EXTENSIONS = {"docx", "txt", "md", "markdown", "json", "csv", "srt"}


class AttachmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=240)
    mime_type: str = Field(default="application/octet-stream", max_length=160)
    size_bytes: int = Field(ge=0, le=MAX_ATTACHMENT_BYTES)
    content_base64: str = Field(min_length=1)


def extract_attachments(
    payloads: list[AttachmentPayload],
    *,
    input_characters: int,
) -> list[tuple[str, str]]:
    if len(payloads) > MAX_ATTACHMENT_COUNT:
        raise ValueError(f"单次最多上传 {MAX_ATTACHMENT_COUNT} 个文件。")
    if sum(item.size_bytes for item in payloads) > MAX_TOTAL_ATTACHMENT_BYTES:
        raise ValueError("附件总大小不能超过 24 MB。")

    extracted: list[tuple[str, str]] = []
    total_characters = input_characters
    for item in payloads:
        extension = PurePath(item.name).suffix.casefold().lstrip(".")
        if extension not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"{item.name} 的格式暂不支持。")
        try:
            content = base64.b64decode(item.content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"{item.name} 的文件内容无法读取。") from exc
        if len(content) != item.size_bytes:
            raise ValueError(f"{item.name} 的文件大小校验失败。")
        if len(content) > MAX_ATTACHMENT_BYTES:
            raise ValueError(f"{item.name} 不能超过 8 MB。")
        text = _extract_docx(content) if extension == "docx" else _decode_text(content)
        text = _normalize_text(text)
        if not text:
            raise ValueError(f"{item.name} 中没有读取到可用文字。")
        if len(text) > MAX_ATTACHMENT_CHARACTERS:
            omitted = len(text) - MAX_ATTACHMENT_CHARACTERS
            marker = f"\n\n[中间内容因长度限制省略 {omitted} 字]\n\n"
            budget = MAX_ATTACHMENT_CHARACTERS - len(marker)
            head = int(budget * 0.75)
            text = f"{text[:head]}{marker}{text[-(budget - head):]}"
        total_characters += len(text)
        if total_characters > MAX_TOTAL_INPUT_CHARACTERS:
            raise ValueError("输入文本与附件提取文字合计不能超过 120,000 字。")
        extracted.append((item.name, text))
    return extracted


def _extract_docx(content: bytes) -> str:
    try:
        with ZipFile(BytesIO(content)) as archive:
            xml = archive.read("word/document.xml")
    except (BadZipFile, KeyError) as exc:
        raise ValueError("DOCX 文件缺少可读取的正文，文件可能已经损坏。") from exc
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as exc:
        raise ValueError("DOCX 正文结构无法解析。") from exc
    output: list[str] = []
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "t" and element.text:
            output.append(element.text)
        elif tag == "tab":
            output.append("\t")
        elif tag in {"br", "cr", "p", "tr"}:
            output.append("\n")
    return "".join(output)


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("文本文件编码无法识别，请转换为 UTF-8 后重试。")


def _normalize_text(value: str) -> str:
    return re.sub(r"\n{4,}", "\n\n\n", value.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")).strip()

