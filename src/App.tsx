import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Papa, { ParseResult } from "papaparse";
import * as XLSX from "xlsx";
import { parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { motion } from "framer-motion";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DataRow = Record<string, string | number | null>;

type NumericStat = {
  column: string;
  mean: number;
  median: number;
  mode: number;
  stdDev: number;
};

type HistogramChart = {
  column: string;
  data: Array<{ bin: string; count: number }>;
};

type CategoryChart = {
  column: string;
  barData: Array<{ category: string; count: number }>;
  pieData: Array<{ name: string; value: number }>;
};

type ScatterPlot = {
  xColumn: string;
  yColumn: string;
  correlation: number;
  sampleSize: number;
  data: Array<{ x: number; y: number }>;
};

type CorrelationPair = {
  colA: string;
  colB: string;
  value: number;
  sampleSize: number;
  strength: string;
};

type CorrelationCell = {
  target: string;
  value: number | null;
};

type CorrelationMatrixRow = {
  column: string;
  values: CorrelationCell[];
};

type AnalysisResult = {
  fileName: string;
  originalRows: number;
  cleanedRows: number;
  columns: string[];
  rows: DataRow[];
  numericColumns: string[];
  categoricalColumns: string[];
  dateColumns: string[];
  columnTypes: Record<string, string>;
  missingPercentBefore: Record<string, number>;
  missingPercentAfter: Record<string, number>;
  uniqueCount: Record<string, number>;
  numericStats: NumericStat[];
  histograms: HistogramChart[];
  categoryCharts: CategoryChart[];
  scatterPlots: ScatterPlot[];
  correlations: CorrelationPair[];
  correlationMatrix: CorrelationMatrixRow[];
  insights: string[];
  cleaningNotes: string[];
};

const CHART_COLORS = ["#2563eb", "#9333ea", "#f97316", "#16a34a", "#dc2626", "#0891b2"];

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const tooltipStyle = {
  backgroundColor: "#0f172a",
  border: "1px solid #334155",
  color: "#e2e8f0",
};

const MAX_SCATTER_POINTS = 1200;
const INITIAL_VISIBLE_HISTOGRAMS = 6;
const INITIAL_VISIBLE_CATEGORY_CHARTS = 4;
const INITIAL_VISIBLE_SCATTER_PLOTS = 4;
const CHART_BATCH_SIZE = 4;

function displayColumnName(column: string): string {
  return column
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeColumnNames(headers: string[]): string[] {
  const seen = new Map<string, number>();

  return headers.map((header, index) => {
    const clean =
      header
        ?.toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || `column_${index + 1}`;

    const count = seen.get(clean) ?? 0;
    seen.set(clean, count + 1);
    return count === 0 ? clean : `${clean}_${count + 1}`;
  });
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().replace(/,/g, "");
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let bestValue = values[0];
  let bestCount = 1;

  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }

  return bestValue;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function stdDev(values: number[], mean: number): number {
  if (values.length <= 1) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => {
      const diff = value - mean;
      return sum + diff * diff;
    }, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function pearsonCorrelation(seriesA: number[], seriesB: number[]): number {
  const n = seriesA.length;
  if (n === 0) {
    return 0;
  }

  const meanA = seriesA.reduce((sum, value) => sum + value, 0) / n;
  const meanB = seriesB.reduce((sum, value) => sum + value, 0) / n;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;

  for (let i = 0; i < n; i += 1) {
    const diffA = seriesA[i] - meanA;
    const diffB = seriesB[i] - meanB;
    numerator += diffA * diffB;
    denomA += diffA * diffA;
    denomB += diffB * diffB;
  }

  if (denomA === 0 || denomB === 0) {
    return 0;
  }

  return numerator / Math.sqrt(denomA * denomB);
}

function chunkHistogram(values: number[], bins = 8): Array<{ bin: string; count: number }> {
  if (!values.length) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ bin: `${numberFormatter.format(min)}`, count: values.length }];
  }

  const binSize = (max - min) / bins;
  const results = Array.from({ length: bins }, (_, idx) => {
    const start = min + idx * binSize;
    const end = idx === bins - 1 ? max : start + binSize;
    return {
      bin: `${numberFormatter.format(start)}-${numberFormatter.format(end)}`,
      count: 0,
    };
  });

  for (const value of values) {
    const binIndex = Math.min(Math.floor((value - min) / binSize), bins - 1);
    results[binIndex].count += 1;
  }

  return results;
}

function sampleEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) {
    return items;
  }

  const sampled: T[] = [];
  const step = items.length / maxItems;
  for (let i = 0; i < maxItems; i += 1) {
    sampled.push(items[Math.floor(i * step)]);
  }
  return sampled;
}

function correlationStrength(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 0.8) {
    return "very strong";
  }
  if (abs >= 0.6) {
    return "strong";
  }
  if (abs >= 0.4) {
    return "moderate";
  }
  if (abs >= 0.2) {
    return "weak";
  }
  return "very weak";
}

function correlationCellColor(value: number | null): string {
  if (value === null) {
    return "bg-slate-800 text-slate-500";
  }
  if (value > 0.7) {
    return "bg-emerald-700/40 text-emerald-100";
  }
  if (value > 0.3) {
    return "bg-emerald-800/30 text-emerald-100";
  }
  if (value < -0.7) {
    return "bg-rose-700/40 text-rose-100";
  }
  if (value < -0.3) {
    return "bg-rose-800/30 text-rose-100";
  }
  return "bg-slate-800/70 text-slate-200";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildBaseName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "").replace(/[^a-z0-9-_]+/gi, "_") || "analysis";
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Delay revoke so slower browsers can start download reliably.
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function buildHtmlReport(analysis: AnalysisResult): string {
  const createdAt = new Date().toLocaleString();
  const strongest = analysis.correlations[0];
  const topCorrelations = analysis.correlations.slice(0, 8);
  const highestSpread = [...analysis.numericStats].sort((a, b) => b.stdDev - a.stdDev).slice(0, 5);
  const categoryLeaders = analysis.categoryCharts
    .map((chart) => {
      const leader = chart.barData[0];
      if (!leader) {
        return null;
      }
      return `${displayColumnName(chart.column)}: ${leader.category} (${leader.count} rows)`;
    })
    .filter((item): item is string => item !== null)
    .slice(0, 8);

  const chartInsights: string[] = [];
  if (strongest) {
    const direction = strongest.value >= 0 ? "positive" : "negative";
    chartInsights.push(
      `Strongest relationship found between ${displayColumnName(strongest.colA)} and ${displayColumnName(
        strongest.colB
      )} with ${direction} correlation (${strongest.value.toFixed(3)}).`
    );
  }
  chartInsights.push(
    ...highestSpread.map(
      (item) =>
        `${displayColumnName(item.column)} shows high spread (std dev ${numberFormatter.format(item.stdDev)}), indicating wider variation.`
    )
  );
  chartInsights.push(...categoryLeaders.map((leader) => `Dominant category observed: ${leader}.`));

  const overviewPoints = [
    `Dataset ${analysis.fileName} contains ${analysis.cleanedRows} cleaned rows and ${analysis.columns.length} columns.`,
    `${analysis.numericColumns.length} numeric, ${analysis.categoricalColumns.length} categorical, and ${analysis.dateColumns.length} date columns were identified.`,
    `${analysis.histograms.length} histogram(s), ${analysis.categoryCharts.length} categorical chart group(s), and ${analysis.scatterPlots.length} scatter plot(s) were generated.`,
    ...analysis.insights.slice(0, 5),
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Auto Data Analyzer Report</title>
  <style>
    body { margin: 0; padding: 28px; font-family: Arial, sans-serif; color: #0f172a; background: #f8fafc; line-height: 1.4; }
    h1, h2 { margin: 0 0 10px; color: #0b1d3f; }
    .meta { margin-bottom: 22px; color: #334155; }
    .section { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    li { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #e2e8f0; }
    .small { color: #475569; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Auto Data Analyzer Report</h1>
  <p class="meta">
    File: <strong>${escapeHtml(analysis.fileName)}</strong><br/>
    Generated: ${escapeHtml(createdAt)}
  </p>

  <section class="section">
    <h2>1. Assessing</h2>
    <ul>
      <li>Rows before cleaning: ${analysis.originalRows}</li>
      <li>Rows after cleaning: ${analysis.cleanedRows}</li>
      <li>Total columns: ${analysis.columns.length}</li>
      <li>Numeric/Categorical/Date: ${analysis.numericColumns.length}/${analysis.categoricalColumns.length}/${analysis.dateColumns.length}</li>
    </ul>
    <table>
      <thead>
        <tr>
          <th>Column</th>
          <th>Type</th>
          <th>Missing Before</th>
          <th>Missing After</th>
          <th>Unique Values</th>
        </tr>
      </thead>
      <tbody>
        ${analysis.columns
          .map(
            (column) => `<tr>
            <td>${escapeHtml(displayColumnName(column))}</td>
            <td>${escapeHtml(analysis.columnTypes[column])}</td>
            <td>${analysis.missingPercentBefore[column].toFixed(2)}%</td>
            <td>${analysis.missingPercentAfter[column].toFixed(2)}%</td>
            <td>${analysis.uniqueCount[column]}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </section>

  <section class="section">
    <h2>2. Cleaning</h2>
    <ul>
      ${analysis.cleaningNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
    </ul>
  </section>

  <section class="section">
    <h2>3. Insights From Graphs</h2>
    <p class="small">These observations are derived from generated histograms, categorical charts, scatter plots, and correlation outputs.</p>
    <ul>
      ${chartInsights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join("")}
    </ul>
    ${topCorrelations.length > 0
      ? `<table>
          <thead>
            <tr>
              <th>Column Pair</th>
              <th>Correlation</th>
              <th>Strength</th>
              <th>Sample Size</th>
            </tr>
          </thead>
          <tbody>
            ${topCorrelations
              .map(
                (pair) => `<tr>
                <td>${escapeHtml(displayColumnName(pair.colA))} vs ${escapeHtml(displayColumnName(pair.colB))}</td>
                <td>${pair.value.toFixed(3)}</td>
                <td>${escapeHtml(pair.strength)}</td>
                <td>${pair.sampleSize}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`
      : "<p>No valid numeric column pairs were available for correlation.</p>"}
  </section>

  <section class="section">
    <h2>4. Overview</h2>
    <ul>
      ${overviewPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
    </ul>
  </section>
</body>
</html>`;
}

function downloadPdfReport(analysis: AnalysisResult): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const maxWidth = pageWidth - marginX * 2;
  let y = 44;

  const ensureSpace = (required: number) => {
    if (y + required > pageHeight - 40) {
      doc.addPage();
      y = 44;
    }
  };

  const heading = (text: string) => {
    ensureSpace(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(text, marginX, y);
    y += 22;
  };

  const paragraph = (text: string, size = 10.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth);
    ensureSpace(lines.length * 13 + 4);
    doc.text(lines, marginX, y);
    y += lines.length * 13 + 4;
  };

  const bullets = (items: string[]) => {
    for (const item of items) {
      paragraph(`- ${item}`);
    }
  };

  const strongest = analysis.correlations[0];
  const topCorrelations = analysis.correlations.slice(0, 10);
  const highestSpread = [...analysis.numericStats].sort((a, b) => b.stdDev - a.stdDev).slice(0, 5);
  const categoryLeaders = analysis.categoryCharts
    .map((chart) => {
      const leader = chart.barData[0];
      if (!leader) {
        return null;
      }
      return `${displayColumnName(chart.column)}: ${leader.category} (${leader.count} rows)`;
    })
    .filter((item): item is string => item !== null)
    .slice(0, 8);

  const graphInsights: string[] = [];
  if (strongest) {
    graphInsights.push(
      `Strongest relationship: ${displayColumnName(strongest.colA)} vs ${displayColumnName(strongest.colB)} with correlation ${strongest.value.toFixed(3)} (${strongest.strength}).`
    );
  }
  graphInsights.push(
    ...highestSpread.map(
      (stat) => `${displayColumnName(stat.column)} has high spread with standard deviation ${numberFormatter.format(stat.stdDev)}.`
    )
  );
  graphInsights.push(...categoryLeaders.map((item) => `Dominant category observed: ${item}.`));

  const overviewPoints = [
    `Dataset ${analysis.fileName} contains ${analysis.cleanedRows} cleaned rows and ${analysis.columns.length} columns.`,
    `${analysis.numericColumns.length} numeric, ${analysis.categoricalColumns.length} categorical, and ${analysis.dateColumns.length} date columns were detected.`,
    `${analysis.histograms.length} histograms, ${analysis.categoryCharts.length} categorical chart groups, and ${analysis.scatterPlots.length} scatter plots were generated.`,
    ...analysis.insights.slice(0, 5),
  ];

  heading("Auto Data Analyzer Report");
  paragraph(`File: ${analysis.fileName}`);
  paragraph(`Generated: ${new Date().toLocaleString()}`);
  y += 4;

  heading("1. Assessing");
  bullets([
    `Rows before cleaning: ${analysis.originalRows}`,
    `Rows after cleaning: ${analysis.cleanedRows}`,
    `Total columns: ${analysis.columns.length}`,
    `Numeric/Categorical/Date: ${analysis.numericColumns.length}/${analysis.categoricalColumns.length}/${analysis.dateColumns.length}`,
  ]);

  ensureSpace(120);
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    head: [["Column", "Type", "Missing Before", "Missing After", "Unique"]],
    body: analysis.columns.map((column) => [
      displayColumnName(column),
      analysis.columnTypes[column],
      `${analysis.missingPercentBefore[column].toFixed(2)}%`,
      `${analysis.missingPercentAfter[column].toFixed(2)}%`,
      String(analysis.uniqueCount[column]),
    ]),
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59] },
  });
  y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    ? ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 16
    : y + 16;

  heading("2. Cleaning");
  bullets(analysis.cleaningNotes);

  heading("3. Insights From Graphs");
  bullets(graphInsights);

  if (topCorrelations.length > 0) {
    ensureSpace(110);
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [["Column Pair", "Correlation", "Strength", "Sample Size"]],
      body: topCorrelations.map((pair) => [
        `${displayColumnName(pair.colA)} vs ${displayColumnName(pair.colB)}`,
        pair.value.toFixed(3),
        pair.strength,
        String(pair.sampleSize),
      ]),
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59] },
    });
    y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
      ? ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 16
      : y + 16;
  }

  heading("4. Overview");
  bullets(overviewPoints);

  const blob = doc.output("blob");
  triggerBlobDownload(blob, `${buildBaseName(analysis.fileName)}_report.pdf`);
}

async function parseUploadedFile(file: File): Promise<DataRow[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        worker: true,
        complete: (results: ParseResult<Record<string, unknown>>) => {
          if (results.errors.length > 0) {
            reject(new Error(results.errors[0].message));
            return;
          }
          resolve(results.data as DataRow[]);
        },
        error: (error: Error) => reject(error),
      });
    });
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null,
      raw: false,
    });
    return rows as DataRow[];
  }

  if (ext === "parquet") {
    const buffer = await file.arrayBuffer();
    const rows = await parquetReadObjects({ file: buffer, compressors });
    return rows as DataRow[];
  }

  throw new Error("Unsupported format. Please upload CSV, Excel, or Parquet files.");
}

function runAnalyzer(fileName: string, rawRows: DataRow[]): AnalysisResult {
  if (!rawRows.length) {
    throw new Error("No data rows found in file.");
  }

  const originalColumns = Object.keys(rawRows[0]);
  const normalizedColumns = normalizeColumnNames(originalColumns);
  const columnMap = new Map(originalColumns.map((col, idx) => [col, normalizedColumns[idx]]));

  const renamedRows: DataRow[] = rawRows.map((row) => {
    const next: DataRow = {};
    for (const [originalCol, normalizedCol] of columnMap.entries()) {
      const value = row[originalCol];
      if (value === "" || value === undefined) {
        next[normalizedCol] = null;
      } else {
        next[normalizedCol] = value as string | number | null;
      }
    }
    return next;
  });

  const dedupedRows: DataRow[] = [];
  const seenRows = new Set<string>();
  for (const row of renamedRows) {
    const key = JSON.stringify(row);
    if (!seenRows.has(key)) {
      seenRows.add(key);
      dedupedRows.push(row);
    }
  }

  const columns = [...normalizedColumns];
  const numericColumns: string[] = [];
  const categoricalColumns: string[] = [];
  const dateColumns: string[] = [];

  for (const column of columns) {
    const values = dedupedRows.map((row) => row[column]).filter((value) => value !== null);
    const numericCount = values.filter((value) => toNumber(value) !== null).length;
    const dateCount = values.filter((value) => {
      if (typeof value !== "string") {
        return false;
      }
      const parsed = Date.parse(value);
      return !Number.isNaN(parsed);
    }).length;

    const ratio = values.length ? numericCount / values.length : 0;
    const dateRatio = values.length ? dateCount / values.length : 0;

    if (ratio >= 0.8) {
      numericColumns.push(column);
    } else if (dateRatio >= 0.8) {
      dateColumns.push(column);
    } else {
      categoricalColumns.push(column);
    }
  }

  const cleaningNotes: string[] = [];
  if (renamedRows.length !== dedupedRows.length) {
    cleaningNotes.push(`Removed ${renamedRows.length - dedupedRows.length} duplicate rows.`);
  }

  const missingPercentBefore: Record<string, number> = {};
  for (const column of columns) {
    const missing = dedupedRows.filter((row) => row[column] === null || row[column] === "").length;
    missingPercentBefore[column] = dedupedRows.length ? (missing / dedupedRows.length) * 100 : 0;
  }

  for (const row of dedupedRows) {
    for (const column of numericColumns) {
      row[column] = toNumber(row[column]);
    }
    for (const column of dateColumns) {
      const value = row[column];
      if (typeof value === "string") {
        const parsed = new Date(value);
        row[column] = Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
      }
    }
  }

  for (const column of columns) {
    const missingIndexes: number[] = [];
    const presentValues: Array<string | number> = [];

    dedupedRows.forEach((row, index) => {
      const value = row[column];
      if (value === null || value === "") {
        missingIndexes.push(index);
      } else {
        presentValues.push(value);
      }
    });

    if (!missingIndexes.length) {
      continue;
    }

    let fillValue: string | number = "Unknown";
    if (numericColumns.includes(column)) {
      const nums = presentValues
        .map((value) => (typeof value === "number" ? value : toNumber(value)))
        .filter((value): value is number => value !== null);
      fillValue = nums.length ? median(nums) : 0;
    } else {
      const freq = new Map<string, number>();
      for (const value of presentValues) {
        const key = String(value);
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
      fillValue = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
    }

    for (const idx of missingIndexes) {
      dedupedRows[idx][column] = fillValue;
    }

    cleaningNotes.push(`Filled ${missingIndexes.length} missing values in ${displayColumnName(column)}.`);
  }

  const missingPercentAfter: Record<string, number> = {};
  const uniqueCount: Record<string, number> = {};
  const columnTypes: Record<string, string> = {};

  for (const column of columns) {
    const columnValues = dedupedRows.map((row) => row[column]);
    const missing = columnValues.filter((value) => value === null || value === "").length;
    missingPercentAfter[column] = columnValues.length ? (missing / columnValues.length) * 100 : 0;
    uniqueCount[column] = new Set(columnValues.map((value) => String(value))).size;

    if (numericColumns.includes(column)) {
      columnTypes[column] = "numeric";
    } else if (dateColumns.includes(column)) {
      columnTypes[column] = "date";
    } else {
      columnTypes[column] = "categorical";
    }
  }

  const numericStats: NumericStat[] = numericColumns
    .map((column) => {
      const values = dedupedRows
        .map((row) => row[column])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

      if (!values.length) {
        return null;
      }

      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        column,
        mean,
        median: median(values),
        mode: mode(values),
        stdDev: stdDev(values, mean),
      };
    })
    .filter((item): item is NumericStat => item !== null);

  const histograms: HistogramChart[] = numericColumns
    .map((column) => {
      const values = dedupedRows
        .map((row) => row[column])
        .filter((value): value is number => typeof value === "number");
      return { column, data: chunkHistogram(values) };
    })
    .filter((item) => item.data.length > 0);

  const categoryCharts: CategoryChart[] = categoricalColumns
    .map((column) => {
      const freq = new Map<string, number>();
      for (const row of dedupedRows) {
        const key = String(row[column]);
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
      const sortedFreq = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      return {
        column,
        barData: sortedFreq.map(([category, count]) => ({ category, count })),
        pieData: sortedFreq.map(([name, value]) => ({ name, value })),
      };
    })
    .filter((item) => item.barData.length > 0);

  const scatterPlots: ScatterPlot[] = [];
  const correlations: CorrelationPair[] = [];
  const correlationLookup = new Map<string, number>();

  for (let i = 0; i < numericColumns.length; i += 1) {
    for (let j = i + 1; j < numericColumns.length; j += 1) {
      const xColumn = numericColumns[i];
      const yColumn = numericColumns[j];
      const points: Array<{ x: number; y: number }> = [];

      for (const row of dedupedRows) {
        const x = row[xColumn];
        const y = row[yColumn];
        if (typeof x === "number" && typeof y === "number") {
          points.push({ x, y });
        }
      }

      if (points.length < 3) {
        continue;
      }

      const pairedA = points.map((point) => point.x);
      const pairedB = points.map((point) => point.y);
      const value = pearsonCorrelation(pairedA, pairedB);
      const roundedValue = Number(value.toFixed(4));
      const sampledPoints = sampleEvenly(points, MAX_SCATTER_POINTS);

      scatterPlots.push({
        xColumn,
        yColumn,
        correlation: roundedValue,
        sampleSize: points.length,
        data: sampledPoints,
      });

      correlations.push({
        colA: xColumn,
        colB: yColumn,
        value: roundedValue,
        sampleSize: points.length,
        strength: correlationStrength(roundedValue),
      });

      correlationLookup.set(`${xColumn}::${yColumn}`, roundedValue);
      correlationLookup.set(`${yColumn}::${xColumn}`, roundedValue);
    }
  }

  const sortedCorrelations = [...correlations].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  const correlationMatrix: CorrelationMatrixRow[] = numericColumns.map((column) => {
    const values = numericColumns.map((target) => {
      if (column === target) {
        return { target, value: 1 };
      }

      const value = correlationLookup.get(`${column}::${target}`);
      return { target, value: value ?? null };
    });

    return { column, values };
  });

  const insights: string[] = [];

  const highMissingColumns = columns.filter((column) => missingPercentBefore[column] > 20);
  if (highMissingColumns.length) {
    insights.push(
      `High missing values before cleaning in: ${highMissingColumns.map(displayColumnName).join(", ")} (more than 20%).`
    );
  }

  if (sortedCorrelations.length > 0) {
    const strongest = sortedCorrelations[0];
    const direction = strongest.value >= 0 ? "positive" : "negative";
    insights.push(
      `Strongest numeric relationship: ${displayColumnName(strongest.colA)} vs ${displayColumnName(
        strongest.colB
      )} with ${direction} correlation ${strongest.value.toFixed(2)} (${strongest.strength}).`
    );
  }

  const dominantCategories = categoryCharts
    .map((chart) => {
      const top = chart.barData[0];
      if (!top) {
        return null;
      }
      return `${displayColumnName(chart.column)} is led by '${top.category}' with ${top.count} rows.`;
    })
    .filter((value): value is string => value !== null)
    .slice(0, 2);
  insights.push(...dominantCategories);

  const volatileMetric = numericStats.sort((a, b) => b.stdDev - a.stdDev)[0];
  if (volatileMetric) {
    insights.push(
      `${displayColumnName(volatileMetric.column)} has the highest spread (std dev ${numberFormatter.format(
        volatileMetric.stdDev
      )}), so it may need outlier checks.`
    );
  }

  if (!insights.length) {
    insights.push("Dataset is clean but limited. Add more numeric or categorical variety for stronger insights.");
  }

  if (!cleaningNotes.length) {
    cleaningNotes.push("No major cleaning actions were needed.");
  }

  return {
    fileName,
    originalRows: rawRows.length,
    cleanedRows: dedupedRows.length,
    columns,
    rows: dedupedRows,
    numericColumns,
    categoricalColumns,
    dateColumns,
    columnTypes,
    missingPercentBefore,
    missingPercentAfter,
    uniqueCount,
    numericStats,
    histograms,
    categoryCharts,
    scatterPlots,
    correlations: sortedCorrelations,
    correlationMatrix,
    insights,
    cleaningNotes,
  };
}

export default function App() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleHistogramCount, setVisibleHistogramCount] = useState(INITIAL_VISIBLE_HISTOGRAMS);
  const [visibleCategoryCount, setVisibleCategoryCount] = useState(INITIAL_VISIBLE_CATEGORY_CHARTS);
  const [visibleScatterCount, setVisibleScatterCount] = useState(INITIAL_VISIBLE_SCATTER_PLOTS);

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const rawRows = await parseUploadedFile(file);
      const result = runAnalyzer(file.name, rawRows);
      setAnalysis(result);
    } catch (uploadError) {
      setAnalysis(null);
      const message = uploadError instanceof Error ? uploadError.message : "Failed to analyze file.";
      setError(message);
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  const previewRows = useMemo(() => analysis?.rows.slice(0, 12) ?? [], [analysis]);
  const displayedHistograms = useMemo(
    () => analysis?.histograms.slice(0, visibleHistogramCount) ?? [],
    [analysis, visibleHistogramCount]
  );
  const displayedCategoryCharts = useMemo(
    () => analysis?.categoryCharts.slice(0, visibleCategoryCount) ?? [],
    [analysis, visibleCategoryCount]
  );
  const displayedScatterPlots = useMemo(
    () => analysis?.scatterPlots.slice(0, visibleScatterCount) ?? [],
    [analysis, visibleScatterCount]
  );

  useEffect(() => {
    setVisibleHistogramCount(INITIAL_VISIBLE_HISTOGRAMS);
    setVisibleCategoryCount(INITIAL_VISIBLE_CATEGORY_CHARTS);
    setVisibleScatterCount(INITIAL_VISIBLE_SCATTER_PLOTS);
  }, [analysis?.fileName]);

  function downloadHtmlReport() {
    if (!analysis) {
      return;
    }

    const report = buildHtmlReport(analysis);
    const blob = new Blob([report], { type: "text/html;charset=utf-8" });
    triggerBlobDownload(blob, `${buildBaseName(analysis.fileName)}_report.html`);
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <section className="relative overflow-hidden border-b border-slate-800 px-6 py-14 md:px-12">
        <motion.div
          className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.24),transparent_45%),radial-gradient(circle_at_80%_20%,rgba(147,51,234,0.2),transparent_42%)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9 }}
        />

        <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8">
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55 }}
            className="space-y-4"
          >
            <p className="text-sm tracking-[0.2em] text-blue-300">AUTO DATA ANALYZER TOOL</p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight md:text-5xl">
              Upload File and get full analysis.
            </h1>
            <p className="max-w-3xl text-base text-slate-300 md:text-lg">
              This AI tool performs deep analysis on your data, find meaningful insights, and presents them through clear charts and graphs. It also generates a final report summarizing the complete analysis in a structured format.
            </p>
          </motion.div>

          <motion.div
            initial={{ y: 22, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.55 }}
            className="flex flex-wrap items-center gap-4"
          >
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-500">
              Upload Dataset
              <input
                type="file"
                className="hidden"
                accept=".csv,.xls,.xlsx,.parquet"
                onChange={handleFileUpload}
              />
            </label>
            <span className="text-sm text-slate-300">Supported: .csv .xls .xlsx .parquet</span>
          </motion.div>

          {loading && <p className="text-sm text-blue-200">Analyzing file and generating dashboard...</p>}
          {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
      </section>

      {analysis && (
        <main className="mx-auto grid w-full max-w-7xl gap-10 px-6 pb-16 pt-10 md:px-12">
          <section className="space-y-3 border-b border-slate-800 pb-6">
           <p className="text-sm text-slate-300">
              Generate a structured report with Assessing, Cleaning, Graph Insights, and Final Overview sections.
            </p>
              <div className="flex flex-wrap items-center justify-start gap-2">
              <button
                type="button"
                onClick={downloadHtmlReport}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
              >
                Download Report (HTML)
              </button>
              <button
                type="button"
                onClick={() => analysis && downloadPdfReport(analysis)}
                className="rounded-md border border-blue-500 px-4 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-500/10"
              >
                Download Report (PDF)
              </button>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Rows after cleaning</p>
              <p className="mt-2 text-3xl font-semibold">{analysis.cleanedRows}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Columns</p>
              <p className="mt-2 text-3xl font-semibold">{analysis.columns.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Numeric / Categorical / Date</p>
              <p className="mt-2 text-3xl font-semibold">
                {analysis.numericColumns.length}/{analysis.categoricalColumns.length}/{analysis.dateColumns.length}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-400">File</p>
              <p className="mt-2 text-lg font-medium text-blue-300">{analysis.fileName}</p>
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Cleaning Summary</h2>
            <div className="grid gap-2 text-sm text-slate-300">
              {analysis.cleaningNotes.map((note) => (
                <p key={note}>- {note}</p>
              ))}
            </div>
          </section>

          <section className="space-y-5 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Numeric Histograms (All Numeric Columns)</h2>
            {analysis.histograms.length === 0 && <p className="text-sm text-slate-300">No numeric columns available.</p>}
            {analysis.histograms.length > 0 && (
              <p className="text-sm text-slate-400">
                Showing {displayedHistograms.length} of {analysis.histograms.length} histograms for faster rendering.
              </p>
            )}
            <div className="grid gap-8 lg:grid-cols-2">
              {displayedHistograms.map((chart) => (
                <motion.div
                  key={chart.column}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                >
                  <p className="mb-3 text-sm text-slate-300">
                    Histogram for <span className="text-blue-300">{displayColumnName(chart.column)}</span> (X-axis:
                    value bins, Y-axis: row count)
                  </p>
                  <div className="h-72 w-full">
                    <ResponsiveContainer>
                      <BarChart data={chart.data} margin={{ top: 8, right: 12, left: 8, bottom: 30 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis
                        dataKey="bin"
                        stroke="#94a3b8"
                        interval={0}
                        tick={{ fontSize: 10 }}
                        label={{
                          value: `${displayColumnName(chart.column)} (bins)`,
                          position: "insideBottom",
                          offset: -10,
                          fill: "#94a3b8",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        label={{
                          value: "Row Count",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#94a3b8",
                          fontSize: 11,
                        }}
                      />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" fill="#2563eb" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>
              ))}
            </div>
            {analysis.histograms.length > displayedHistograms.length && (
              <button
                type="button"
                onClick={() => setVisibleHistogramCount((prev) => prev + CHART_BATCH_SIZE)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                Load more histograms
              </button>
            )}
          </section>

          <section className="space-y-5 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Categorical Charts (All Categorical Columns)</h2>
            {analysis.categoryCharts.length === 0 && (
              <p className="text-sm text-slate-300">No categorical columns available.</p>
            )}
            {analysis.categoryCharts.length > 0 && (
              <p className="text-sm text-slate-400">
                Showing {displayedCategoryCharts.length} of {analysis.categoryCharts.length} categorical chart groups.
              </p>
            )}
            <div className="grid gap-8 lg:grid-cols-2">
              {displayedCategoryCharts.map((chart) => (
                <motion.div
                  key={chart.column}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                >
                  <p className="mb-3 text-sm text-slate-300">
                    Category distribution for <span className="text-blue-300">{displayColumnName(chart.column)}</span>
                    (X-axis: categories, Y-axis: count)
                  </p>
                  <div className="grid h-72 grid-cols-2 gap-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart.barData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          dataKey="category"
                          stroke="#94a3b8"
                          interval={0}
                          tick={{ fontSize: 10 }}
                          label={{
                            value: `${displayColumnName(chart.column)} (categories)`,
                            position: "insideBottom",
                            offset: -10,
                            fill: "#94a3b8",
                            fontSize: 11,
                          }}
                        />
                        <YAxis
                          stroke="#94a3b8"
                          label={{
                            value: "Count",
                            angle: -90,
                            position: "insideLeft",
                            fill: "#94a3b8",
                            fontSize: 11,
                          }}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Bar dataKey="count" fill="#9333ea" />
                      </BarChart>
                    </ResponsiveContainer>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chart.pieData}
                          dataKey="value"
                          nameKey="name"
                          outerRadius={85}
                          label={{ fill: "#e2e8f0", fontSize: 10 }}
                        >
                          {chart.pieData.map((entry, idx) => (
                            <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>
              ))}
            </div>
            {analysis.categoryCharts.length > displayedCategoryCharts.length && (
              <button
                type="button"
                onClick={() => setVisibleCategoryCount((prev) => prev + CHART_BATCH_SIZE)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                Load more categorical charts
              </button>
            )}
          </section>

          <section className="space-y-5 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Scatter Plots (All Valid Numeric Combinations)</h2>
            {analysis.scatterPlots.length === 0 && (
              <p className="text-sm text-slate-300">Need at least two numeric columns with enough values.</p>
            )}
            {analysis.scatterPlots.length > 0 && (
              <p className="text-sm text-slate-400">
                Showing {displayedScatterPlots.length} of {analysis.scatterPlots.length} scatter plots. Each plot uses at most
                {` ${MAX_SCATTER_POINTS}`} sampled points for faster rendering.
              </p>
            )}
            <div className="grid gap-8 lg:grid-cols-2">
              {displayedScatterPlots.map((plot) => (
                <motion.div
                  key={`${plot.xColumn}-${plot.yColumn}`}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
                >
                  <p className="mb-3 text-sm text-slate-300">
                    Scatter: <span className="text-blue-300">{displayColumnName(plot.xColumn)}</span> (X-axis) vs{" "}
                    <span className="text-blue-300">{displayColumnName(plot.yColumn)}</span> (Y-axis) | Correlation{" "}
                    {plot.correlation.toFixed(2)} | Points {plot.data.length}/{plot.sampleSize}
                  </p>
                  <div className="h-72 w-full">
                    <ResponsiveContainer>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          type="number"
                          dataKey="x"
                          stroke="#94a3b8"
                          label={{
                            value: displayColumnName(plot.xColumn),
                            position: "insideBottom",
                            offset: -10,
                            fill: "#94a3b8",
                            fontSize: 11,
                          }}
                        />
                        <YAxis
                          type="number"
                          dataKey="y"
                          stroke="#94a3b8"
                          label={{
                            value: displayColumnName(plot.yColumn),
                            angle: -90,
                            position: "insideLeft",
                            fill: "#94a3b8",
                            fontSize: 11,
                          }}
                        />
                        <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} />
                        <Scatter data={plot.data} fill="#22d3ee" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>
              ))}
            </div>
            {analysis.scatterPlots.length > displayedScatterPlots.length && (
              <button
                type="button"
                onClick={() => setVisibleScatterCount((prev) => prev + CHART_BATCH_SIZE)}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                Load more scatter plots
              </button>
            )}
          </section>

          <section className="space-y-4 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Statistical Analysis</h2>
            <div className="w-full max-w-4xl overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-sm">
                <thead className="bg-slate-800/70 text-left text-slate-300">
                  <tr>
                    <th className="px-3 py-2">Column</th>
                    <th className="px-3 py-2">Mean</th>
                    <th className="px-3 py-2">Median</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Std Dev</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.numericStats.map((stat, idx) => (
                    <tr key={stat.column} className={idx % 2 === 0 ? "bg-slate-900/40" : "bg-slate-900/10"}>
                      <td className="px-3 py-2 text-slate-100">{displayColumnName(stat.column)}</td>
                      <td className="px-3 py-2 text-slate-200">{numberFormatter.format(stat.mean)}</td>
                      <td className="px-3 py-2 text-slate-200">{numberFormatter.format(stat.median)}</td>
                      <td className="px-3 py-2 text-slate-200">{numberFormatter.format(stat.mode)}</td>
                      <td className="px-3 py-2 text-slate-200">{numberFormatter.format(stat.stdDev)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Correlation Analysis</h2>
            {analysis.correlations.length === 0 && (
              <p className="text-sm text-slate-300">Need at least two numeric columns with enough rows.</p>
            )}

            {analysis.correlations.length > 0 && (
              <>
                <div className="w-full max-w-5xl overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-800/70 text-left text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Column Pair</th>
                        <th className="px-3 py-2">Correlation</th>
                        <th className="px-3 py-2">Strength</th>
                        <th className="px-3 py-2">Sample Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.correlations.map((pair, idx) => (
                        <tr
                          key={`${pair.colA}-${pair.colB}`}
                          className={idx % 2 === 0 ? "bg-slate-900/40" : "bg-slate-900/10"}
                        >
                          <td className="px-3 py-2 text-slate-100">
                            {displayColumnName(pair.colA)} vs {displayColumnName(pair.colB)}
                          </td>
                          <td className="px-3 py-2 text-slate-200">{pair.value.toFixed(3)}</td>
                          <td className="px-3 py-2 text-slate-200">{pair.strength}</td>
                          <td className="px-3 py-2 text-slate-200">{pair.sampleSize}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="w-full max-w-5xl overflow-x-auto rounded-lg border border-slate-800 p-3">
                  <p className="mb-3 text-sm text-slate-300">Correlation Matrix Heatmap (all numeric columns)</p>
                  <table className="border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="p-2 text-left text-slate-400">Column</th>
                        {analysis.numericColumns.map((column) => (
                          <th key={column} className="p-2 text-left text-slate-400">
                            {displayColumnName(column)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.correlationMatrix.map((row) => (
                        <tr key={row.column}>
                          <td className="p-2 text-slate-300">{displayColumnName(row.column)}</td>
                          {row.values.map((cell) => (
                            <td key={`${row.column}-${cell.target}`} className={`p-2 ${correlationCellColor(cell.value)}`}>
                              {cell.value === null ? "NA" : cell.value.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="space-y-3 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Insights</h2>
            <ul className="space-y-2 text-sm text-slate-200">
              {analysis.insights.map((insight) => (
                <li key={insight} className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
                  {insight}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-4 border-t border-slate-800 pt-8">
            <h2 className="text-xl font-semibold">Data Preview</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-800/80 text-left text-slate-300">
                  <tr>
                    <th className="sticky left-0 z-10 bg-slate-800 px-3 py-2">#</th>
                    {analysis.columns.map((column) => (
                      <th key={column} className="min-w-44 px-3 py-2 align-top">
                        <p className="font-medium text-slate-100">{displayColumnName(column)}</p>
                        <p className="text-xs text-slate-400">{analysis.columnTypes[column]}</p>
                        <p className="text-xs text-slate-500">
                          Missing before {analysis.missingPercentBefore[column].toFixed(1)}% | after{" "}
                          {analysis.missingPercentAfter[column].toFixed(1)}% | unique {analysis.uniqueCount[column]}
                        </p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIdx) => (
                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? "bg-slate-900/30" : "bg-slate-900/5"}>
                      <td className="sticky left-0 bg-slate-900 px-3 py-2 text-slate-400">{rowIdx + 1}</td>
                      {analysis.columns.map((column) => (
                        <td key={column} className="max-w-56 px-3 py-2 text-slate-200">
                          <div className="truncate">{row[column] === null ? "NA" : String(row[column])}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}