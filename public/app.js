import {
  bidPercentSortValue,
  formatBidPercent,
  formatFractionPercent,
  fractionPercentSortValue,
} from "./format.js";

const AUTO_RELOAD_MS = 60 * 60 * 1000;

const reloadBtn = document.getElementById("reload-btn");
const statusEl = document.getElementById("status");
const reloadTimerEl = document.getElementById("reload-timer");
const isinCountEl = document.getElementById("isin-count");
const isinsFileEl = document.getElementById("isins-file");
const resultsPanel = document.getElementById("results-panel");
const resultsHeaderRow = document.getElementById("results-header-row");
const resultsBody = document.getElementById("results-body");
const summaryEl = document.getElementById("summary");

const COLUMNS = [
  { key: "isin", label: "ISIN", sortable: true },
  { key: "underlyings", label: "Underlying", sortable: true },
  { key: "initialFixing", label: "Fixing", sortable: true },
  { key: "priceChangePct", label: "% vs fix", sortable: true },
  { key: "couponPa", label: "Coupon P.A.", sortable: true },
  { key: "currency", label: "CCY", sortable: true },
  { key: "barrierLevel", label: "Barrier", sortable: true },
  { key: "maturity", label: "Maturity", sortable: true },
  { key: "nextAutocallObservation", label: "Next obs.", sortable: true },
  { key: "bid", label: "Bid", sortable: true },
  { key: "paidCoupons", label: "Paid %", sortable: true },
  { key: "bidPlusPaidCoupons", label: "Bid + paid", sortable: true },
];

let products = [];
let sortKey = "isin";
let sortDir = "asc";
let reloadInProgress = false;
let lastReloadAt = null;
let nextReloadAt = null;
let autoReloadTimeout = null;
let countdownInterval = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPrice(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedPercent(fraction) {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const pct = fraction * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function renderUnderlyingStack(details, formatLine) {
  if (!details?.length) return "—";
  return `<div class="underlying-stack">${details
    .map((u) => `<div class="underlying-line">${formatLine(u)}</div>`)
    .join("")}</div>`;
}

function formatCell(value, key) {
  if (value == null || value === "") return "—";
  if (
    key === "paidCoupons" ||
    key === "couponPa" ||
    key === "bidPlusPaidCoupons"
  ) {
    return formatFractionPercent(value);
  }
  if (key === "bid") {
    return formatBidPercent(value);
  }
  return String(value);
}

function sortValue(product, key) {
  if (product.error) return null;

  const raw = product[key];
  if (raw == null || raw === "") return null;

  if (key === "bid") {
    return bidPercentSortValue(Number(raw));
  }

  if (
    key === "paidCoupons" ||
    key === "couponPa" ||
    key === "bidPlusPaidCoupons"
  ) {
    return fractionPercentSortValue(Number(raw));
  }

  if (key === "maturity" || key === "nextAutocallObservation") {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : t;
  }

  if (key === "barrierLevel") {
    const match = String(raw).match(/[\d.]+/);
    return match ? Number(match[0]) : null;
  }

  if (key === "initialFixing") {
    const first = product.underlyingDetails?.[0];
    if (!first?.initialFixing) return null;
    return Number(first.initialFixing);
  }

  if (key === "priceChangePct") {
    const details = product.underlyingDetails ?? [];
    const values = details
      .map((u) => u.priceChangePct)
      .filter((v) => v != null);
    if (values.length === 0) return null;
    return Math.min(...values);
  }

  return String(raw).toLowerCase();
}

function compareProducts(a, b) {
  const aMissing = a.error ? 1 : 0;
  const bMissing = b.error ? 1 : 0;
  if (aMissing !== bMissing) return aMissing - bMissing;

  const av = sortValue(a, sortKey);
  const bv = sortValue(b, sortKey);
  const aEmpty = av == null;
  const bEmpty = bv == null;
  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  if (aEmpty && bEmpty) return 0;

  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
  }

  return sortDir === "asc" ? cmp : -cmp;
}

function renderHeader() {
  resultsHeaderRow.innerHTML = COLUMNS.map((col) => {
    const active = sortKey === col.key;
    const indicator = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th scope="col" class="sortable${active ? " sorted" : ""}" data-sort="${col.key}" aria-sort="${active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}">${col.label}${indicator}</th>`;
  }).join("");

  resultsHeaderRow.querySelectorAll("[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = "asc";
      }
      renderProducts();
    });
  });
}

function renderProducts() {
  const sorted = [...products].sort(compareProducts);
  resultsBody.innerHTML = "";

  for (const product of sorted) {
    const row = document.createElement("tr");
    if (product.error) {
      row.classList.add("row-error");
      row.innerHTML = `
        <td class="mono">${product.isin}</td>
        <td colspan="10">${product.error}</td>
      `;
    } else {
      if (product.barrierHit) row.classList.add("row-barrier-hit");
      const details = product.underlyingDetails ?? [];
      row.innerHTML = `
        <td class="mono">${formatCell(product.isin)}</td>
        <td class="muted underlyings col-compact">${renderUnderlyingStack(details, (u) => escapeHtml(u.name))}</td>
        <td class="numeric col-compact">${renderUnderlyingStack(details, (u) => formatPrice(u.initialFixing))}</td>
        <td class="numeric col-compact">${renderUnderlyingStack(details, (u) => formatSignedPercent(u.priceChangePct))}</td>
        <td class="numeric">${formatCell(product.couponPa, "couponPa")}</td>
        <td>${formatCell(product.currency)}</td>
        <td>${formatCell(product.barrierLevel)}</td>
        <td>${formatCell(product.maturity)}</td>
        <td>${formatCell(product.nextAutocallObservation)}</td>
        <td class="numeric">${formatCell(product.bid, "bid")}</td>
        <td class="numeric">${formatCell(product.paidCoupons, "paidCoupons")}</td>
        <td class="numeric">${formatCell(product.bidPlusPaidCoupons, "bidPlusPaidCoupons")}</td>
      `;
    }
    resultsBody.appendChild(row);
  }

  const found = products.filter((p) => !p.error).length;
  const barrierHits = products.filter((p) => p.barrierHit).length;
  summaryEl.textContent =
    barrierHits > 0
      ? `${found} of ${products.length} products loaded · ${barrierHits} barrier hit`
      : `${found} of ${products.length} products loaded`;
  resultsPanel.classList.remove("hidden");
}

function formatCountdown(ms) {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateReloadTimer() {
  if (!reloadTimerEl) return;
  const last = lastReloadAt
    ? new Date(lastReloadAt).toLocaleString()
    : "—";
  const remaining = nextReloadAt ? Math.max(0, nextReloadAt - Date.now()) : 0;
  reloadTimerEl.textContent = `Last reload: ${last} · Next auto-reload in ${formatCountdown(remaining)}`;
}

function scheduleAutoReload() {
  if (autoReloadTimeout) clearTimeout(autoReloadTimeout);
  nextReloadAt = Date.now() + AUTO_RELOAD_MS;
  autoReloadTimeout = setTimeout(() => {
    reload({ auto: true });
  }, AUTO_RELOAD_MS);
  updateReloadTimer();
}

function startCountdownTicker() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateReloadTimer, 1000);
}

async function reload({ auto = false } = {}) {
  if (reloadInProgress) return;
  reloadInProgress = true;
  reloadBtn.disabled = true;
  setStatus(
    auto ? "Auto-reload: reading CSV and looking up products…" : "Reading CSV and looking up products…",
  );

  try {
    const response = await fetch("/api/reload", { method: "POST" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Reload failed");
    }

    if (payload.file) {
      isinsFileEl.textContent = payload.file.replace(/^.*\/data\//, "data/");
    }

    isinCountEl.textContent = `${payload.count} ISINs in file`;
    products = payload.products;
    renderProducts();
    lastReloadAt = Date.now();
    scheduleAutoReload();
    const prefix = auto ? "Auto-reload finished" : "Finished";
    setStatus(`${prefix} — ${payload.found} of ${payload.count} ISINs resolved.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Reload failed", true);
    scheduleAutoReload();
  } finally {
    reloadInProgress = false;
    reloadBtn.disabled = false;
  }
}

renderHeader();
startCountdownTicker();
reloadBtn.addEventListener("click", () => reload({ auto: false }));
reload();
