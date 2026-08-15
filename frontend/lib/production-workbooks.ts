import {
  formatEpisodeRanges,
  frequencySummary,
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
  const headers = [
    "角色", "编号", "角色名", "中文名", "类型", "身份", "核心特征", "关键关联",
    "出现次数", "设计要点", "性格特色", "人物特点",
  ];
  sheet.addRow(headers);
  for (const character of index.characters) {
    sheet.addRow([
      character.englishName || character.chineseName || character.name,
      character.code,
      character.englishName || character.name,
      character.chineseName || character.name,
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
  finalizeTable(sheet, headers.length, [18, 9, 18, 18, 14, 24, 28, 24, 12, 28, 24, 38], {
    projectTitle,
    rowHeight: 58,
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
  sheet.mergeCells("A1:E1");
  sheet.getCell("A1").value = `${projectTitle} · 快速统计摘要（完整版）`;
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: COLORS.ink } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lime } };
  sheet.getRow(1).height = 32;
  const headers = ["类型", "总数", "高频（出现≥10次）", "中频（5–9次）", "低频（1–4次）"];
  sheet.addRow(headers);
  for (const row of frequencySummary(index)) {
    sheet.addRow([row.type, row.total, row.high || "—", row.medium || "—", row.low || "—"]);
  }
  finalizeTable(sheet, headers.length, [16, 12, 40, 40, 54], {
    projectTitle,
    headerRow: 2,
    rowHeight: 92,
  });
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
    sheet.addRow([
      character.chineseName || character.englishName || character.name,
      props.map((prop) => {
        const label = prop.chineseName || prop.englishName || prop.name;
        if (prop.owners.includes(character.name)) return `${label}（持有/归属）`;
        if (prop.directUsers.includes(character.name)) return `${label}（使用/直接接触）`;
        return `${label}（同场接触）`;
      }).join("、"),
      props.filter((prop) => prop.owners.includes(character.name))
        .map((prop) => prop.chineseName || prop.englishName || prop.name)
        .join("、") || "正文未明确归属",
    ]);
  }

  const spacerRow = sheet.addRow([]);
  spacerRow.height = 12;
  const sectionRow = sheet.addRow(["附：高频核心道具归属简表"]);
  sheet.mergeCells(sectionRow.number, 1, sectionRow.number, 3);
  sectionRow.getCell(1).font = { bold: true, size: 13, color: { argb: COLORS.ink } };
  sectionRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.lime } };
  sectionRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  const secondaryHeaderRow = sheet.addRow(["道具", "主要使用/持有者", "次要使用/接触者"]);
  styleHeaderRow(secondaryHeaderRow, 3);
  for (const prop of index.props.filter((item) => item.appearanceCount >= 5).slice(0, 30)) {
    sheet.addRow([
      prop.chineseName || prop.englishName || prop.name,
      [...new Set([...prop.owners, ...prop.directUsers])].join("、") || "未明确",
      prop.secondaryContacts.join("、") || "—",
    ]);
  }
  finalizeTable(sheet, 3, [24, 64, 46], { projectTitle, rowHeight: 50 });
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
    if (!row.height) row.height = options.rowHeight;
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.font = { size: 10.5, color: { argb: COLORS.ink } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: rowNumber % 2 === 0 ? COLORS.white : COLORS.soft },
      };
      cell.border = thinBorder();
    }
  }
  sheet.headerFooter.oddHeader = `&L序幕TV · 剧本大师&C${options.projectTitle}&R制作资料`;
  sheet.headerFooter.oddFooter = "&L最终正文自动整理&C第 &P / &N 页&R&A";
  sheet.properties.defaultRowHeight = 22;
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
