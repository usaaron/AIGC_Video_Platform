import { applyEnglishCharacterNames } from "./bilingual-dialogue.ts";
import { ACTING_PROFILE_FIELDS, ACTING_PROFILE_LABELS } from "./character-acting-profile.ts";
import {
  formatEpisodeRanges,
  type ProductionIndex,
} from "./production-index.ts";

export const PRODUCTION_WORKBOOK_FILENAMES = [
  "人设表.xlsx",
  "场景.xlsx",
  "道具.xlsx",
  "出现频率统计.xlsx",
  "人物道具对照表（谁使用或接触了哪些道具）.xlsx",
] as const;

export interface ProductionWorkbookAttachment {
  filename: typeof PRODUCTION_WORKBOOK_FILENAMES[number];
  content: Blob;
}

const MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const COLORS = {
  ink: "272B24",
  muted: "667064",
  line: "CFD5CB",
  soft: "F5F6F2",
  lime: "D9F36A",
  white: "FFFFFF",
};

export async function createProductionWorkbookAttachments(
  projectTitle: string,
  index: ProductionIndex,
): Promise<ProductionWorkbookAttachment[]> {
  const excel = (await import("exceljs")).default;
  const factories: Array<{
    filename: ProductionWorkbookAttachment["filename"];
    build: (workbook: InstanceType<typeof excel.Workbook>) => void;
  }> = [
    { filename: "人设表.xlsx", build: (workbook) => buildCharacterWorkbook(workbook, projectTitle, index) },
    { filename: "场景.xlsx", build: (workbook) => buildSceneWorkbook(workbook, projectTitle, index) },
    { filename: "道具.xlsx", build: (workbook) => buildPropWorkbook(workbook, projectTitle, index) },
    { filename: "出现频率统计.xlsx", build: (workbook) => buildFrequencyWorkbook(workbook, projectTitle, index) },
    {
      filename: "人物道具对照表（谁使用或接触了哪些道具）.xlsx",
      build: (workbook) => buildCharacterPropWorkbook(workbook, projectTitle, index),
    },
  ];
  const attachments: ProductionWorkbookAttachment[] = [];
  for (const factory of factories) {
    const workbook = new excel.Workbook();
    workbook.creator = "序幕TV 剧本大师";
    workbook.subject = `${projectTitle} 制作资料`;
    workbook.title = factory.filename.replace(/\.xlsx$/i, "");
    workbook.company = "序幕TV";
    factory.build(workbook);
    if (index.characterNameLanguage === "en") {
      const aliases = new Map(index.characters.filter(character => character.chineseName && character.englishName)
        .map(character => [character.chineseName, character.englishName]));
      workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
        if (typeof cell.value === "string") cell.value = applyEnglishCharacterNames(cell.value, aliases);
      })));
    }
    const buffer = await workbook.xlsx.writeBuffer();
    attachments.push({
      filename: factory.filename,
      content: new Blob([buffer as BlobPart], { type: MIME_TYPE }),
    });
  }
  return attachments;
}

function buildCharacterWorkbook(
  workbook: WorkbookLike,
  projectTitle: string,
  index: ProductionIndex,
): void {
  const sheet = workbook.addWorksheet("人设表", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: landscapePageSetup(),
  });
  const englishNames = index.characterNameLanguage === "en";
  const headers = [
    "角色", "编号", "角色名", ...(englishNames ? [] : ["中文名"]), "类型", "身份", "核心特征", "关键关联",
    "出现次数", "设计要点", "性格特色", "人物特点",
  ];
  sheet.addRow(headers);
  for (const character of index.characters) {
    sheet.addRow([
      character.englishName || character.chineseName || character.name,
      character.code,
      character.englishName || character.name,
      ...(englishNames ? [] : [character.chineseName || character.name]),
      character.role,
      character.identity,
      character.coreTraits,
      character.relationships.join("、"),
      character.appearanceCount,
      character.designNotes,
      character.personality,
      character.description,
    ]);
  }
  finalizeTable(sheet, headers.length, [18, 9, 18, ...(englishNames ? [] : [18]), 14, 24, 28, 24, 12, 28, 24, 38], {
    projectTitle,
    rowHeight: 58,
  });
  const actingSheet = workbook.addWorksheet("角色表演档案", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
    pageSetup: landscapePageSetup(),
  });
  const actingHeaders = ["角色", "表演项目", "表演指导"];
  actingSheet.addRow(actingHeaders);
  for (const character of index.characters) {
    for (const field of ACTING_PROFILE_FIELDS) {
      actingSheet.addRow([englishNames ? character.englishName || character.name : character.chineseName || character.name,
        ACTING_PROFILE_LABELS[field], character.actingProfile?.[field] || null]);
    }
  }
  finalizeTable(actingSheet, actingHeaders.length, [18, 22, 96], {
    projectTitle, rowHeight: 40,
  });
}

function buildSceneWorkbook(
  workbook: WorkbookLike,
  projectTitle: string,
  index: ProductionIndex,
): void {
  const sheet = workbook.addWorksheet("场景", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: landscapePageSetup(),
  });
  const headers = ["场景", "中文名", "出现集数", "出现次数", "功能", "氛围/设计关键词"];
  sheet.addRow(headers);
  for (const scene of index.scenes) {
    sheet.addRow([
      scene.englishName || scene.name,
      scene.chineseName || scene.name,
      formatEpisodeRanges(scene.episodeNumbers),
      scene.appearanceCount,
      scene.functions.join("、") || "剧情承载",
      scene.designKeywords.join("、") || "按正文场景描述执行",
    ]);
  }
  finalizeTable(sheet, headers.length, [28, 28, 20, 12, 32, 32], { projectTitle, rowHeight: 48 });
}

function buildPropWorkbook(
  workbook: WorkbookLike,
  projectTitle: string,
  index: ProductionIndex,
): void {
  const sheet = workbook.addWorksheet("道具", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: landscapePageSetup(),
  });
  const headers = ["道具", "中文名", "功能", "关联场景/角色", "出现次数", "设计重点"];
  sheet.addRow(headers);
  for (const prop of index.props) {
    sheet.addRow([
      prop.englishName || prop.name,
      prop.chineseName || prop.name,
      prop.functions.join("、") || "剧情行动道具",
      [...prop.relatedScenes, ...prop.relatedCharacters].join("、"),
      prop.appearanceCount,
      prop.designNotes.join("、") || "按正文中的外观与状态保持一致",
    ]);
  }
  finalizeTable(sheet, headers.length, [26, 24, 32, 38, 12, 34], { projectTitle, rowHeight: 46 });
}

function buildFrequencyWorkbook(
  workbook: WorkbookLike,
  projectTitle: string,
  index: ProductionIndex,
): void {
  const sheet = workbook.addWorksheet("出现频率统计", {
    views: [{ state: "frozen", ySplit: 2 }],
    pageSetup: landscapePageSetup(),
  });
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = `${projectTitle} · 快速统计摘要（完整版）`;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: COLORS.ink } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lime } };
  sheet.getRow(1).height = 32;
  const headers = ["类型", "总数", "高频（出现≥10次）", "中频（5–9次）", "低频（1–4次）", "未出场（0次）"];
  sheet.addRow(headers);
  const groups = [
    { type: "人物", items: index.characters },
    { type: "场景", items: index.scenes },
    { type: "道具", items: index.props },
  ];
  for (const { type, items } of groups) {
    sheet.addRow([type, items.length,
      items.filter(item => item.appearanceCount >= 10).length,
      items.filter(item => item.appearanceCount >= 5 && item.appearanceCount < 10).length,
      items.filter(item => item.appearanceCount > 0 && item.appearanceCount < 5).length,
      items.filter(item => item.appearanceCount === 0).length]);
  }
  finalizeTable(sheet, headers.length, [16, 12, 26, 24, 24, 22], {
    projectTitle,
    headerRow: 2,
    rowHeight: 40,
  });
  const note = sheet.addRow(["人物按出场集数统计；场景和道具按出现场次统计。完整名称、次数及集数见“频次明细”。"]);
  sheet.mergeCells(note.number, 1, note.number, headers.length);
  note.height = 40;
  note.getCell(1).font = { size: 10.5, color: { argb: COLORS.muted } };
  note.getCell(1).alignment = { wrapText: true, vertical: "middle" };

  const detail = workbook.addWorksheet("频次明细", {
    views: [{ state: "frozen", ySplit: 1 }], pageSetup: landscapePageSetup(),
  });
  detail.addRow(["类型", "名称", "出现次数", "频次档位", "出现集数"]);
  for (const { type, items } of groups) {
    for (const item of items) {
      const count = item.appearanceCount;
      detail.addRow([type, type === "人物" && index.characterNameLanguage === "en" ? item.englishName || item.name : item.chineseName || item.name, count,
        count >= 10 ? "高频" : count >= 5 ? "中频" : count > 0 ? "低频" : "未出场",
        formatEpisodeRanges(item.episodeNumbers ?? []) || "—"]);
    }
  }
  finalizeTable(detail, 5, [14, 46, 14, 16, 34], { projectTitle, rowHeight: 36 });
}

function buildCharacterPropWorkbook(
  workbook: WorkbookLike,
  projectTitle: string,
  index: ProductionIndex,
): void {
  const sheet = workbook.addWorksheet("人物道具对照表", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: landscapePageSetup(),
  });
  const headers = ["人物", "使用或接触的道具", "道具归属"];
  sheet.addRow(headers);
  for (const character of index.characters) {
    const props = index.props.filter((prop) => (
      prop.directUsers.includes(character.name)
      || prop.secondaryContacts.includes(character.name)
      || prop.owners.includes(character.name)
      || prop.relatedCharacters.includes(character.name)
    ));
    if (!props.length) continue;
    for (const prop of props) {
      const label = prop.chineseName || prop.englishName || prop.name;
      const relationship = prop.owners.includes(character.name) ? "持有/归属"
        : prop.directUsers.includes(character.name) ? "使用/直接接触" : "同场出现，未确认接触";
      sheet.addRow([
        index.characterNameLanguage === "en" ? character.englishName || character.name : character.chineseName || character.name,
        `${label}（${relationship}）`, prop.owners.join("、") || "正文未明确归属",
      ]);
    }
  }

  const spacerRow = sheet.addRow([]);
  spacerRow.height = 12;
  const sectionRow = sheet.addRow(["附：高频核心道具归属简表"]);
  sheet.mergeCells(sectionRow.number, 1, sectionRow.number, 3);
  sectionRow.getCell(1).font = { bold: true, size: 13, color: { argb: COLORS.ink } };
  sectionRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lime } };
  sectionRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  const secondaryHeaderRow = sheet.addRow(["道具", "主要使用/持有者", "同场人物（未确认接触）"]);
  styleHeaderRow(secondaryHeaderRow, 3);
  for (const prop of index.props.filter((item) => item.appearanceCount >= 5).slice(0, 30)) {
    sheet.addRow([
      prop.chineseName || prop.englishName || prop.name,
      [...new Set([...prop.owners, ...prop.directUsers])].join("、") || "未明确",
      prop.secondaryContacts.join("、") || "—",
    ]);
  }
  finalizeTable(sheet, 3, [24, 64, 46], { projectTitle, rowHeight: 50 });
  styleHeaderRow(secondaryHeaderRow, 3);
  sectionRow.getCell(1).font = { bold: true, size: 13, color: { argb: COLORS.ink } };
  sectionRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lime } };
}

function finalizeTable(
  sheet: WorksheetLike,
  columnCount: number,
  widths: number[],
  options: { projectTitle: string; headerRow?: number; rowHeight: number },
): void {
  const headerRowNumber = options.headerRow ?? 1;
  styleHeaderRow(sheet.getRow(headerRowNumber), columnCount);
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: Math.max(headerRowNumber, sheet.rowCount), column: columnCount },
  };
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    let requiredHeight = options.rowHeight;
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      // Empty strings have no business value and some XLSX readers display
      // their shared-string index. Emit a genuinely empty cell instead.
      if (cell.value === "") cell.value = null;
      requiredHeight = Math.max(requiredHeight, wrappedTextHeight(cell.text, widths[column - 1]));
      cell.alignment = { horizontal: typeof cell.value === "number" ? "right" : "left", vertical: "middle", wrapText: true };
      cell.font = { size: 10.5, color: { argb: COLORS.ink } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: rowNumber % 2 === 0 ? COLORS.white : COLORS.soft },
      };
      cell.border = thinBorder();
    }
    if (!row.height) row.height = Math.min(409, requiredHeight);
  }
  sheet.headerFooter.oddHeader = `&L序幕TV · 剧本大师&C${options.projectTitle}&R制作资料`;
  sheet.headerFooter.oddFooter = "&L最终正文自动整理&C第 &P / &N 页&R&A";
  sheet.properties.defaultRowHeight = 22;
}

function wrappedTextHeight(text: string, width: number): number {
  const capacity = Math.max(1, width - 2);
  const lines = text.split(/\r?\n/).reduce((sum, line) => {
    const units = [...line].reduce((count, character) => count + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0);
    return sum + Math.max(1, Math.ceil(units / capacity));
  }, 0);
  return lines * 15 + 12;
}

function styleHeaderRow(row: RowLike, columnCount: number): void {
  row.height = 34;
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = { bold: true, size: 11, color: { argb: COLORS.ink } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lime } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder();
  }
}

function thinBorder() {
  const side = { style: "thin" as const, color: { argb: COLORS.line } };
  return { top: side, left: side, bottom: side, right: side };
}

function landscapePageSetup() {
  return {
    orientation: "landscape" as const,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };
}

type ExcelModule = typeof import("exceljs");
type WorkbookLike = InstanceType<ExcelModule["Workbook"]>;
type WorksheetLike = ReturnType<WorkbookLike["addWorksheet"]>;
type RowLike = ReturnType<WorksheetLike["getRow"]>;
