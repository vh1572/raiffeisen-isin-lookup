import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseIsinsFromCsv } from "./lib/csv.js";
import { lookupIsins } from "./lib/api.js";
import { summarizeLookupResults } from "./lib/extract.js";
import { scanBrcProducts } from "./lib/brcScan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT) || 3000;
const ISINS_FILE =
  process.env.ISINS_FILE ?? path.join(__dirname, "data", "products.csv");
const API_OPTIONS = {
  partner: process.env.RAIFFEISEN_PARTNER ?? "RAIFFEISEN",
  region: process.env.RAIFFEISEN_REGION ?? "CH",
  language: process.env.RAIFFEISEN_LANGUAGE ?? "EN",
};

function readIsinsFromFile() {
  if (!fs.existsSync(ISINS_FILE)) {
    throw new Error(`ISIN file not found: ${ISINS_FILE}`);
  }
  const isins = parseIsinsFromCsv(fs.readFileSync(ISINS_FILE));
  if (isins.length === 0) {
    throw new Error("No valid ISINs in file. Use a column named isin or one ISIN per line.");
  }
  if (isins.length > 100) {
    throw new Error("Maximum 100 ISINs per file.");
  }
  return isins;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/isins", (_req, res) => {
  try {
    const isins = readIsinsFromFile();
    res.json({ file: ISINS_FILE, count: isins.length, isins });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to read ISIN file",
    });
  }
});

app.post("/api/brc-scan", async (req, res) => {
  try {
    const body = req.body ?? {};
    const maturityDays = Number(body.maturityDays);
    const bidMin = Number(body.bidMin);
    const bidMax = Number(body.bidMax);

    const result = await scanBrcProducts({
      ...API_OPTIONS,
      maturityDays: Number.isFinite(maturityDays) ? maturityDays : undefined,
      bidMin: Number.isFinite(bidMin) ? bidMin : undefined,
      bidMax: Number.isFinite(bidMax) ? bidMax : undefined,
    });

    res.json({
      ...result,
      options: API_OPTIONS,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "BRC scan failed",
    });
  }
});

app.post("/api/reload", async (_req, res) => {
  try {
    const isins = readIsinsFromFile();
    const results = await lookupIsins(isins, API_OPTIONS);
    const products = summarizeLookupResults(results, API_OPTIONS.language.toLowerCase());

    res.json({
      file: ISINS_FILE,
      count: products.length,
      found: products.filter((p) => !p.error).length,
      isins,
      products,
      options: API_OPTIONS,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Reload failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Raiffeisen ISIN lookup running at http://localhost:${PORT}`);
  console.log(`Reading ISINs from ${ISINS_FILE}`);
});
