/**
 * Shopify Supplier CSV Normalizer Engine
 * 100% Client-Side. No external network requests.
 */

const SHOPIFY_COLUMNS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Product Category", "Type", "Tags",
  "Published", "Option1 Name", "Option1 Value", "Variant SKU", "Variant Grams",
  "Variant Inventory Tracker", "Variant Inventory Qty", "Variant Inventory Policy",
  "Variant Fulfillment Service", "Variant Price", "Variant Compare At Price",
  "Variant Requires Shipping", "Variant Taxable", "Image Src", "Image Position",
  "Image Alt Text", "Status"
];

const ALIAS_MAP = {
  "Title": ["product_title", "product_name", "title", "name", "item_name", "item_title"],
  "Body (HTML)": ["description", "body", "details", "long_description", "desc", "detail_description"],
  "Vendor": ["vendor", "brand", "supplier", "brand_name", "manufacturer", "store_name", "supplier_name"],
  "Variant SKU": ["vendor_sku", "sku", "item_id", "code", "sku_code", "product_code"],
  "Variant Price": ["wholesale_cost", "supply_price", "wholesale_price", "drop_ship_price", "cost", "price"],
  "Variant Compare At Price": ["retail_msrp", "suggested_price", "msrp", "retail_price", "compare_at_price"],
  "Variant Inventory Qty": ["in_stock_qty", "stock_count", "quantity_available", "qty_available", "stock", "qty", "quantity"],
  "Variant Grams": ["item_weight_lbs", "weight_lbs", "shipping_weight", "weight", "weight_lbs", "weight_g"],
  "Image Src": ["supplier_image", "main_image_url", "product_image_1", "primary_image", "image", "image_url", "photo"]
};

let rawRows = [];
let supplierHeaders = [];
let currentMapping = {};
let isLicensed = false;

// DOM Elements
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const presetSelect = document.getElementById("preset-select");
const mappingPanel = document.getElementById("mapping-panel");
const mappingGrid = document.getElementById("mapping-grid");
const btnApplyMapping = document.getElementById("btn-apply-mapping");
const resultsControls = document.getElementById("results-controls");
const previewSection = document.getElementById("preview-section");
const btnExportCsv = document.getElementById("btn-export-shopify-csv");
const btnReset = document.getElementById("btn-reset");
const licenseModal = document.getElementById("license-modal");
const btnCloseModal = document.getElementById("btn-close-modal");
const btnActivateLicense = document.getElementById("btn-activate-license");
const licenseKeyInput = document.getElementById("license-key-input");

// Helpers
function generateHandle(title) {
  if (!title) return "product";
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseWeightToGrams(val) {
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  if (isNaN(num)) return 0;
  // If explicitly in grams already
  if (String(val).toLowerCase().includes('g') && !String(val).toLowerCase().includes('kg')) {
    return Math.round(num);
  }
  // Default supplier exports are in lbs
  return Math.round(num * 453.592);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line) {
    const result = [];
    let startValueIndex = 0;
    let insideQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        insideQuotes = !insideQuotes;
      } else if (line[i] === ',' && !insideQuotes) {
        let val = line.substring(startValueIndex, i).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1).replace(/""/g, '"');
        result.push(val);
        startValueIndex = i + 1;
      }
    }
    let val = line.substring(startValueIndex).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1).replace(/""/g, '"');
    result.push(val);
    return result;
  }

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j];
      }
      rows.push(row);
    }
  }
  return { headers, rows };
}

function autoMatchHeaders(headers) {
  const mapping = {};
  const lowerHeaders = headers.map(h => ({ raw: h, clean: h.toLowerCase().replace(/[^a-z0-9]/g, '_') }));

  for (const [shopifyCol, aliases] of Object.entries(ALIAS_MAP)) {
    mapping[shopifyCol] = "";
    for (const item of lowerHeaders) {
      if (aliases.includes(item.clean) || aliases.some(a => item.clean.includes(a))) {
        mapping[shopifyCol] = item.raw;
        break;
      }
    }
  }
  return mapping;
}

function renderMappingUI() {
  mappingGrid.innerHTML = "";
  for (const [shopifyCol, mappedVal] of Object.entries(ALIAS_MAP)) {
    const item = document.createElement("div");
    item.className = "mapping-item";
    
    let optionsHtml = `<option value="">-- Leave Blank / Default --</option>`;
    for (const h of supplierHeaders) {
      const selected = (currentMapping[shopifyCol] === h) ? "selected" : "";
      optionsHtml += `<option value="${h}" ${selected}>${h}</option>`;
    }

    item.innerHTML = `
      <div class="mapping-label">Shopify: <strong>${shopifyCol}</strong></div>
      <select class="mapping-select" data-col="${shopifyCol}">${optionsHtml}</select>
    `;
    mappingGrid.appendChild(item);
  }

  mappingPanel.classList.remove("hidden");
  dropZone.classList.add("hidden");
}

function processAndRenderTable() {
  const selects = document.querySelectorAll(".mapping-select");
  selects.forEach(sel => {
    currentMapping[sel.dataset.col] = sel.value;
  });

  const shopifyRows = rawRows.map(row => {
    const title = currentMapping["Title"] ? (row[currentMapping["Title"]] || "") : "";
    const handle = generateHandle(title);
    const price = currentMapping["Variant Price"] ? (row[currentMapping["Variant Price"]] || "") : "";
    const comparePrice = currentMapping["Variant Compare At Price"] ? (row[currentMapping["Variant Compare At Price"]] || "") : "";
    const sku = currentMapping["Variant SKU"] ? (row[currentMapping["Variant SKU"]] || "") : "";
    const rawWeight = currentMapping["Variant Grams"] ? (row[currentMapping["Variant Grams"]] || "") : 0;
    const grams = parseWeightToGrams(rawWeight);
    const qty = currentMapping["Variant Inventory Qty"] ? (row[currentMapping["Variant Inventory Qty"]] || "0") : "0";
    const vendor = currentMapping["Vendor"] ? (row[currentMapping["Vendor"]] || "Default Vendor") : "Default Vendor";
    const imageSrc = currentMapping["Image Src"] ? (row[currentMapping["Image Src"]] || "") : "";
    const body = currentMapping["Body (HTML)"] ? (row[currentMapping["Body (HTML)"]] || "") : "";

    return {
      "Handle": handle,
      "Title": title,
      "Body (HTML)": body,
      "Vendor": vendor,
      "Product Category": "",
      "Type": "",
      "Tags": "",
      "Published": "TRUE",
      "Option1 Name": "Title",
      "Option1 Value": "Default Title",
      "Variant SKU": sku,
      "Variant Grams": grams,
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Qty": qty,
      "Variant Inventory Policy": "deny",
      "Variant Fulfillment Service": "manual",
      "Variant Price": price,
      "Variant Compare At Price": comparePrice,
      "Variant Requires Shipping": "TRUE",
      "Variant Taxable": "TRUE",
      "Image Src": imageSrc,
      "Image Position": imageSrc ? "1" : "",
      "Image Alt Text": title,
      "Status": "active"
    };
  });

  // Update Stats
  document.getElementById("stat-total-products").innerText = shopifyRows.length;
  document.getElementById("stat-mapped-cols").innerText = `${Object.values(currentMapping).filter(Boolean).length} / 24`;
  document.getElementById("stat-weights-normalized").innerText = "Grams (ISO)";

  // Render Table Preview (first 25)
  const previewRows = shopifyRows.slice(0, 25);
  const headRow = document.getElementById("table-head-row");
  const tableBody = document.getElementById("table-body");
  
  headRow.innerHTML = "";
  SHOPIFY_COLUMNS.slice(0, 10).forEach(col => {
    const th = document.createElement("th");
    th.innerText = col;
    headRow.appendChild(th);
  });

  tableBody.innerHTML = "";
  previewRows.forEach(row => {
    const tr = document.createElement("tr");
    SHOPIFY_COLUMNS.slice(0, 10).forEach(col => {
      const td = document.createElement("td");
      td.innerText = row[col] || "";
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });

  resultsControls.classList.remove("hidden");
  previewSection.classList.remove("hidden");

  // Check row threshold
  if (shopifyRows.length > 25 && !isLicensed) {
    document.getElementById("modal-row-count").innerText = shopifyRows.length;
    licenseModal.classList.remove("hidden");
  }

  window._generatedShopifyRows = shopifyRows;
}

function exportShopifyCSV() {
  const rows = window._generatedShopifyRows || [];
  if (rows.length === 0) return;

  const exportRows = isLicensed ? rows : rows.slice(0, 25);
  
  let csvContent = SHOPIFY_COLUMNS.join(",") + "\n";
  exportRows.forEach(row => {
    const line = SHOPIFY_COLUMNS.map(col => {
      let val = String(row[col] || "").replace(/"/g, '""');
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        val = `"${val}"`;
      }
      return val;
    }).join(",");
    csvContent += line + "\n";
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `shopify_catalog_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Event Listeners
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = function(evt) {
    const { headers, rows } = parseCSV(evt.target.result);
    supplierHeaders = headers;
    rawRows = rows;
    currentMapping = autoMatchHeaders(headers);
    renderMappingUI();
  };
  reader.readAsText(file);
}

btnApplyMapping.addEventListener("click", processAndRenderTable);
btnExportCsv.addEventListener("click", exportShopifyCSV);
btnReset.addEventListener("click", () => location.reload());

btnCloseModal.addEventListener("click", () => licenseModal.classList.add("hidden"));
btnActivateLicense.addEventListener("click", () => {
  const key = licenseKeyInput.value.trim();
  if (key.length >= 8) {
    isLicensed = true;
    localStorage.setItem("shopify_normalizer_license", key);
    alert("✅ Pro License Activated! Unlimited rows unlocked.");
    licenseModal.classList.add("hidden");
  } else {
    alert("Please enter a valid license key.");
  }
});

if (localStorage.getItem("shopify_normalizer_license")) {
  isLicensed = true;
}
