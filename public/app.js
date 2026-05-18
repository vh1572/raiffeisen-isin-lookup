const reloadBtn = document.getElementById("reload-btn");
const statusEl = document.getElementById("status");
const isinCountEl = document.getElementById("isin-count");
const isinsFileEl = document.getElementById("isins-file");
const resultsPanel = document.getElementById("results-panel");
const resultsHeaderRow = document.getElementById("results-header-row");
const resultsBody = document.getElementById("results-body");
const summaryEl = document.getElementById("summary");

const COLUMNS = [
  { key: "isin", label: "ISIN", sortable: true },
  { key: "underlyings", label: "Underlyings", sortable: true },
  { key: "couponPa", label: "Coupon P.A.", sortable: true },
  { key: "currency", label: "Currency", sortable: true },
  { key: "bid", label: "Bid", sortable: true },
  { key: "barrierLevel", label: "Barrier", sortable: true },
  { key: "maturity", label: "Maturity", sortable: true },
  { key: "paidCoupons", label: "Paid coupons (% nom.)", sortable: true },
  { key: "details", label: "", sortable: false },
];

let products = [];
let sortKey = "isin";
let sortDir = "asc";

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function formatCell(value, key) {
  if (value == null || value === "") return "—";
  if (
    (key === "paidCoupons" || key === "couponPa") &&
    typeof value === "number"
  ) {
    const pct = value > 1 ? value : value * 100;
    return `${pct.toFixed(2)}%`;
  }
  return String(value);
}

function sortValue(product, key) {
  if (product.error) return null;

  const raw = product[key];
  if (raw == null || raw === "") return null;

  if (key === "bid" || key === "paidCoupons" || key === "couponPa") {
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
        <td colspan="7">${product.error}</td>
        <td></td>
      `;
    } else {
      if (product.barrierHit) row.classList.add("row-barrier-hit");
      const paidCouponsDisplay =
        product.paidCoupons != null
          ? formatCell(product.paidCoupons, "paidCoupons")
          : "—";
      row.innerHTML = `
        <td class="mono">${formatCell(product.isin)}</td>
        <td class="muted underlyings">${formatCell(product.underlyings)}</td>
        <td class="numeric">${formatCell(product.couponPa, "couponPa")}</td>
        <td>${formatCell(product.currency)}</td>
        <td>${formatCell(product.bid)}</td>
        <td>${formatCell(product.barrierLevel)}</td>
        <td>${formatCell(product.maturity)}</td>
        <td class="numeric">${paidCouponsDisplay}</td>
        <td><a class="link" href="${product.productUrl}" target="_blank" rel="noreferrer">Details</a></td>
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

async function reload() {
  reloadBtn.disabled = true;
  setStatus("Reading CSV and looking up products…");

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
    setStatus(`Finished — ${payload.found} of ${payload.count} ISINs resolved.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Reload failed", true);
  } finally {
    reloadBtn.disabled = false;
  }
}

renderHeader();
reloadBtn.addEventListener("click", reload);
reload();
