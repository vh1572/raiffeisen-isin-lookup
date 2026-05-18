import { parse } from "csv-parse/sync";

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function parseIsinsFromCsv(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  if (records.length === 0) {
    return parseIsinsFromLines(text);
  }

  const headers = Object.keys(records[0]);
  const isinColumn =
    headers.find((h) => h.toLowerCase() === "isin") ??
    headers.find((h) => h.toLowerCase().includes("isin")) ??
    headers[0];

  const isins = [];
  for (const row of records) {
    const raw = String(row[isinColumn] ?? "").trim().toUpperCase();
    if (raw && ISIN_PATTERN.test(raw)) {
      isins.push(raw);
    }
  }

  return [...new Set(isins)];
}

function parseIsinsFromLines(text) {
  const isins = [];
  for (const line of text.split(/\r?\n/)) {
    const token = line.split(/[,;\t]/)[0]?.trim().toUpperCase();
    if (token && ISIN_PATTERN.test(token)) {
      isins.push(token);
    }
  }
  return [...new Set(isins)];
}
