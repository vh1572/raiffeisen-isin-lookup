const scanBtn = document.getElementById("scan-btn");
const statusEl = document.getElementById("status");
const maturityDaysEl = document.getElementById("maturity-days");
const bidMinEl = document.getElementById("bid-min");
const bidMaxEl = document.getElementById("bid-max");
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
  { key: "bid", label: "Bid", sortable: true },
  { key: "paidCoupons", label: "Paid %", sortable: true },
  { key: "bidPlusPaidCoupons", label: "Bid + paid", sortable: true },
  { key: "productUrl", label: "Details", sortable: false },
];

let products = [];
let sortKey = "maturity";
let sortDir = "asc";
let scanInProgress = false;

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
    (key === "paidCoupons" ||
      key === "couponPa" ||
      key === "bidPlusPaidCoupons") &&
    typeof value === "number"
  ) {
    const pct = value > 1 ? value : value * 100;
    return `${pct.toFixed(2)}%`;
  }
  if (key === "bid" && typeof value === "number") {
    const pct = value > 1 ? value : value * 100;
    return `${pct.toFixed(2)}%`;
  }
  return String(value);
}

function sortValue(product, key) {
  if (product.error) return null;
  if (key === "productUrl") return null;

  const raw = product[key];
  if (raw == null || raw === "") return null;

  if (
    key === "bid" ||
    key === "paidCoupons" ||
    key === "couponPa" ||
    key === "bidPlusPaidCoupons"
  ) {
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  if (key === "maturity") {
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
    if (!col.sortable) {
      return `<th scope="col">${col.label}</th>`;
    }
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
        <td class="numeric">${formatCell(product.bid, "bid")}</td>
        <td class="numeric">${formatCell(product.paidCoupons, "paidCoupons")}</td>
        <td class="numeric">${formatCell(product.bidPlusPaidCoupons, "bidPlusPaidCoupons")}</td>
        <td><a href="${escapeHtml(product.productUrl)}" target="_blank" rel="noreferrer">Open</a></td>
      `;
    }
    resultsBody.appendChild(row);
  }

  summaryEl.textContent = `${products.length} match${products.length === 1 ? "" : "es"}`;
  resultsPanel.classList.remove("hidden");
}

async function runScan() {
  if (scanInProgress) return;
  scanInProgress = true;
  scanBtn.disabled = true;
  setStatus("Scanning BRC products (this may take a few seconds)…");

  try {
    const response = await fetch("/api/brc-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maturityDays: Number(maturityDaysEl.value),
        bidMin: Number(bidMinEl.value),
        bidMax: Number(bidMaxEl.value),
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Scan failed");
    }

    products = payload.products ?? [];
    renderProducts();
    setStatus(
      `Scanned ${payload.scanned} BRC products (≤6 months maturity on server) · ${payload.count} match filter.`,
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Scan failed", true);
  } finally {
    scanInProgress = false;
    scanBtn.disabled = false;
  }
}

renderHeader();
scanBtn.addEventListener("click", runScan);
