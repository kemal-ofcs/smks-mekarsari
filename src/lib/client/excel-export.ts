"use client";

import { type DownloadResult, saveFileWithPicker } from "./download";
import { createXlsxBuffer } from "./xlsx";

export async function exportToExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): Promise<DownloadResult> {
  const xlsxBytes = createXlsxBuffer(headers, rows, sheetName || "Sheet1");
  const blob = new Blob([xlsxBytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return saveFileWithPicker(
    blob,
    filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`,
    {
      description: "Spreadsheet Excel (.xlsx)",
      accept: {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
          ".xlsx",
        ],
      },
    },
  );
}

export async function exportToCsv(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): Promise<DownloadResult> {
  let csvText = `${headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(",")}\n`;
  for (const row of rows) {
    const formatted = row.map((val) => {
      if (val === null || val === undefined) return '""';
      if (typeof val === "number") return String(val);
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csvText += `${formatted.join(",")}\n`;
  }
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  return saveFileWithPicker(
    blob,
    filename.endsWith(".csv") ? filename : `${filename}.csv`,
    {
      description: "File CSV (.csv)",
      accept: {
        "text/csv": [".csv"],
      },
    },
  );
}
