const BASE_URL = "https://pub-ec7e75da12684e40b7b1178d5a2c05f4.r2.dev";

const searchInput = document.getElementById("food-search");
const suggestionsList = document.getElementById("suggestions");
const resultBox = document.getElementById("result");
const typeFilter = document.getElementById("type-filter");

let currentSearchBucket = "";
let currentSearchData = [];
let currentProduct = null;

function getLetterBucket(name) {
  if (!name) return "other";
  const first = name[0].toLowerCase();

  if (first >= "a" && first <= "z") return first;
  if (!isNaN(first)) return "numeric";
  return "other";
}

async function loadSearchBucket(bucket) {
  if (bucket === currentSearchBucket) return;

  try {
    const response = await fetch(`${BASE_URL}/search/${bucket}.json`);

    if (!response.ok) {
      throw new Error(`Failed to load search bucket ${bucket}: ${response.status}`);
    }

    currentSearchData = await response.json();
    currentSearchBucket = bucket;
    console.log(`Loaded bucket ${bucket}:`, currentSearchData.length);
  } catch (error) {
    console.error(error);
    currentSearchData = [];
    currentSearchBucket = "";
  }
}

function scoreMatch(item, query) {
  const name = (item.product_name || "").toLowerCase();
  const q = query.toLowerCase();

  let score = 0;

  if (name === q) score += 100;
  else if (name.startsWith(q)) score += 60;
  else if (name.includes(q)) score += 20;

  score += item.quality_score || 0;

  if (item.type === "generic") score += 10;

  return score;
}

function getMatches(query) {
  const q = query.toLowerCase().trim();
  const filter = typeFilter.value;

  if (!q) return [];

  return currentSearchData
    .filter((item) => {
      const name = (item.product_name || "").toLowerCase();
      const matchesQuery = name.includes(q);

      if (!matchesQuery) return false;

      if (filter === "generic") return item.type === "generic";
      if (filter === "packaged") return item.type === "packaged";

      return true;
    })
    .sort((a, b) => scoreMatch(b, q) - scoreMatch(a, q))
    .slice(0, 10);
}

function renderSuggestions(matches) {
  suggestionsList.innerHTML = "";

  if (matches.length === 0) {
    suggestionsList.style.display = "none";
    return;
  }

  for (const item of matches) {
    const li = document.createElement("li");

    const typeBadge =
      item.type === "generic"
        ? `<span class="badge badge-green">Generic</span>`
        : `<span class="badge badge-blue">Packaged</span>`;

    const groupLabel = item.group
      ? `<span class="group">${escapeHtml(item.group)}</span>`
      : "";

    const brandLabel = item.brand
      ? `<div class="brand">${escapeHtml(item.brand)}</div>`
      : "";

    li.innerHTML = `
      <div class="suggestion-row">
        <div class="main">
          <strong>${escapeHtml(item.product_name || "")}</strong>
          ${groupLabel}
        </div>
        <div class="meta">
          ${brandLabel}
          ${typeBadge}
        </div>
      </div>
    `;

    li.addEventListener("click", () => {
      searchInput.value = item.product_name || "";
      suggestionsList.style.display = "none";
      loadProductDetails(item.code, item.chunk);
    });

    suggestionsList.appendChild(li);
  }

  suggestionsList.style.display = "block";
}

async function loadProductDetails(code, chunk) {
  try {
    const response = await fetch(`${BASE_URL}/details/${chunk}`);

    if (!response.ok) {
      throw new Error(`Failed to load details file ${chunk}: ${response.status}`);
    }

    const details = await response.json();
    const product = details.find((item) => item.code === code);

    if (!product) {
      currentProduct = null;
      resultBox.innerHTML = `<p>Product not found in ${escapeHtml(chunk)}.</p>`;
      return;
    }

    currentProduct = product;
    renderProduct(product);
  } catch (error) {
    console.error(error);
    currentProduct = null;
    resultBox.innerHTML = `<p>Error loading product details.</p>`;
  }
}

function formatValue(value, suffix = "") {
  return value === null || value === undefined || value === ""
    ? "—"
    : `${value}${suffix}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderProduct(product) {
  resultBox.innerHTML = `
    <article class="card">
      <h2>${escapeHtml(product.product_name || "Unknown product")}</h2>

      <p class="meta"><strong>Brand:</strong> ${escapeHtml(product.brand || "—")}</p>
      <p class="meta"><strong>Barcode:</strong> ${escapeHtml(product.barcode || "—")}</p>
      <p class="meta"><strong>Country:</strong> ${escapeHtml(product.country || "—")}</p>
      <p class="meta"><strong>Serving size:</strong> ${escapeHtml(product.serving_size || "—")}</p>
      <p class="meta"><strong>Ingredients:</strong> ${escapeHtml(product.ingredients || "—")}</p>
      <p class="meta"><strong>Group:</strong> ${escapeHtml(product.group || "—")}</p>
      <p class="meta"><strong>Type:</strong> ${escapeHtml(product.type || "—")}</p>
      <p class="meta"><strong>Quality score:</strong> ${product.quality_score ?? "—"}</p>

      <div class="grid">
        <div><strong>Energy</strong><br>${formatValue(product.kcal, " kcal")}</div>
        <div><strong>Fat</strong><br>${formatValue(product.fat, " g")}</div>
        <div><strong>Carbohydrates</strong><br>${formatValue(product.carbs, " g")}</div>
        <div><strong>Protein</strong><br>${formatValue(product.protein, " g")}</div>
        <div><strong>Fiber</strong><br>${formatValue(product.fiber, " g")}</div>
        <div><strong>Sodium</strong><br>${formatValue(product.sodium, " g")}</div>
      </div>

      <p class="small"><strong>Unit:</strong> ${escapeHtml(product.unit || "g")} | <strong>Qty:</strong> ${product.qty ?? 100}</p>
      <p class="small"><strong>Notes:</strong> ${escapeHtml(product.notes || "—")}</p>

      <button id="copy-btn" class="copy-btn" type="button">Copy for Nutrium</button>
    </article>
  `;

  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyNutriumFormat);
  }
}

async function copyNutriumFormat() {
  if (!currentProduct) return;

  const text = [
    `Name: ${currentProduct.product_name || ""}`,
    `Group: ${currentProduct.group || ""}`,
    `Type: ${currentProduct.type || ""}`,
    `Unit: ${currentProduct.unit || "g"}`,
    `Qty: ${currentProduct.qty ?? 100}`,
    `kcal: ${currentProduct.kcal ?? ""}`,
    `Fat: ${currentProduct.fat ?? ""}`,
    `Carbs: ${currentProduct.carbs ?? ""}`,
    `Protein: ${currentProduct.protein ?? ""}`,
    `Fiber: ${currentProduct.fiber ?? ""}`,
    `Sodium: ${currentProduct.sodium ?? ""}`,
    `Brand: ${currentProduct.brand || ""}`,
    `Country: ${currentProduct.country || ""}`,
    `Serving size: ${currentProduct.serving_size || ""}`,
    `Ingredients: ${currentProduct.ingredients || ""}`,
    `Barcode: ${currentProduct.barcode || ""}`,
    `Notes: ${currentProduct.notes || ""}`
  ].join("\n");

  try {
    await navigator.clipboard.writeText(text);
    alert("Copied for Nutrium.");
  } catch (error) {
    console.error(error);
    alert("Copy failed.");
  }
}

async function handleSearchInput() {
  const query = searchInput.value.trim();

  if (!query) {
    suggestionsList.style.display = "none";
    suggestionsList.innerHTML = "";
    return;
  }

  const bucket = getLetterBucket(query);
  await loadSearchBucket(bucket);

  const matches = getMatches(query);
  renderSuggestions(matches);
}

searchInput.addEventListener("input", handleSearchInput);
typeFilter.addEventListener("change", handleSearchInput);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrapper")) {
    suggestionsList.style.display = "none";
  }
});