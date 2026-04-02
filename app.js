const BASE_URL = "https://pub-ec7e75da12684e40b7b1178d5a2c05f4.r2.dev";

const searchInput = document.getElementById("food-search");
const suggestionsList = document.getElementById("suggestions");
const resultBox = document.getElementById("result");
const typeFilter = document.getElementById("type-filter");

let currentSearchBucket = "";
let currentSearchData = [];
let currentProduct = null;
let currentDetailsChunk = [];
let currentChunkName = "";

/* ----------------------------- */
/* Helpers                       */
/* ----------------------------- */

function getLetterBucket(name) {
  if (!name) return "other";
  const first = name[0].toLowerCase();

  if (first >= "a" && first <= "z") return first;
  if (!isNaN(first)) return "numeric";
  return "other";
}

function formatValue(value, suffix = "") {
  return value === null || value === undefined || value === ""
    ? "—"
    : `${value}${suffix}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

/* ----------------------------- */
/* Search bucket loading         */
/* ----------------------------- */

async function loadSearchBucket(bucket) {
  if (bucket === currentSearchBucket) return;

  try {
    const response = await fetch(`${BASE_URL}/search/${bucket}.json`, {
      cache: "no-store"
    });

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

/* ----------------------------- */
/* Product details loading       */
/* ----------------------------- */

async function loadProductDetails(code, chunk) {
  try {
    currentChunkName = chunk;

    const response = await fetch(`${BASE_URL}/details/${chunk}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Failed to load details file ${chunk}: ${response.status}`);
    }

    const details = await response.json();
    currentDetailsChunk = details;

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
    currentDetailsChunk = [];
    currentChunkName = "";
    resultBox.innerHTML = `<p>Error loading product details.</p>`;
  }
}

/* ----------------------------- */
/* Alternatives logic            */
/* ----------------------------- */

function safeNumber(value) {
  return value === null || value === undefined || value === "" ? null : Number(value);
}

function calculateMacroDistance(baseItem, candidate) {
  const baseKcal = safeNumber(baseItem.kcal);
  const baseFat = safeNumber(baseItem.fat);
  const baseCarbs = safeNumber(baseItem.carbs);
  const baseProtein = safeNumber(baseItem.protein);
  const baseFiber = safeNumber(baseItem.fiber);
  const baseSodium = safeNumber(baseItem.sodium);

  const candKcal = safeNumber(candidate.kcal);
  const candFat = safeNumber(candidate.fat);
  const candCarbs = safeNumber(candidate.carbs);
  const candProtein = safeNumber(candidate.protein);
  const candFiber = safeNumber(candidate.fiber);
  const candSodium = safeNumber(candidate.sodium);

  let distance = 0;

  if (baseKcal !== null && candKcal !== null) distance += Math.abs(baseKcal - candKcal) * 0.08;
  if (baseFat !== null && candFat !== null) distance += Math.abs(baseFat - candFat) * 1.0;
  if (baseCarbs !== null && candCarbs !== null) distance += Math.abs(baseCarbs - candCarbs) * 1.0;
  if (baseProtein !== null && candProtein !== null) distance += Math.abs(baseProtein - candProtein) * 1.2;
  if (baseFiber !== null && candFiber !== null) distance += Math.abs(baseFiber - candFiber) * 0.6;
  if (baseSodium !== null && candSodium !== null) distance += Math.abs(baseSodium - candSodium) * 0.2;

  return distance;
}

function getAlternativeFoods(baseItem, allItems) {
  if (!baseItem || !Array.isArray(allItems) || allItems.length === 0) {
    return [];
  }

  const seenNames = new Set();

  return allItems
    .filter((item) => item.code !== baseItem.code)
    .filter((item) => item.group === baseItem.group)
    .filter((item) => item.product_name && item.product_name.trim() !== "")
    .filter((item) => {
      const normalized = item.product_name.trim().toLowerCase();
      if (normalized === baseItem.product_name.trim().toLowerCase()) return false;
      if (seenNames.has(normalized)) return false;
      seenNames.add(normalized);
      return true;
    })
    .map((item) => ({
      ...item,
      distance: calculateMacroDistance(baseItem, item)
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

function renderAlternativeFoods(baseItem) {
  const alternatives = getAlternativeFoods(baseItem, currentDetailsChunk);

  if (!alternatives.length) {
    return `
      <p class="small"><strong>Alternative foods:</strong> No close alternatives found in the current dataset chunk.</p>
    `;
  }

  const links = alternatives
    .map((item) => {
      return `
        <a href="#" class="alt-link" data-code="${escapeHtml(item.code)}" data-chunk="${escapeHtml(currentChunkName)}">
          ${escapeHtml(item.product_name)}
        </a>
      `;
    })
    .join(" • ");

  return `
    <p class="small"><strong>Alternative foods:</strong> ${links}</p>
  `;
}

function attachAlternativeClickHandlers() {
  const links = document.querySelectorAll(".alt-link");

  links.forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();

      const code = link.dataset.code;
      const chunk = link.dataset.chunk;

      if (!code || !chunk) return;

      await loadProductDetails(code, chunk);

      const resultSection = document.getElementById("result");
      if (resultSection) {
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

/* ----------------------------- */
/* Product rendering             */
/* ----------------------------- */

function renderProduct(product) {
  const alternativesHtml = renderAlternativeFoods(product);

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

      ${alternativesHtml}
    </article>
  `;

  attachAlternativeClickHandlers();
}

/* ----------------------------- */
/* Input handlers                */
/* ----------------------------- */

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
