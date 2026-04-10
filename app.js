const BASE_URL = "https://pub-ec7e75da12684e40b7b1178d5a2c05f4.r2.dev";

const EXCHANGE_TARGETS = {
  protein: 7,
  carbs: 15,
  fat: 5
};

const MIN_PORTION_GRAMS = 5;
const MAX_PORTION_GRAMS = 400;
const DOMINANCE_RATIO = 1.1;

const searchInput = document.getElementById("food-search");
const suggestionsList = document.getElementById("suggestions");
const resultBox = document.getElementById("result");
const typeFilter = document.getElementById("type-filter");

const view100gBtn = document.getElementById("view-100g");
const viewPortionBtn = document.getElementById("view-portion");
const viewModePill = document.getElementById("view-mode-pill");

let currentSearchBucket = "";
let currentSearchData = [];
let currentProduct = null;
let currentDetailsChunk = [];
let currentChunkName = "";
let currentViewMode = "100g";
const portionCache = new Map();

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
  return value === null || value === undefined || value === "" || Number.isNaN(Number(value))
    ? "—"
    : `${formatNumber(value)}${suffix}`;
}

function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "—";
  }

  const numeric = Number(value);
  if (Number.isInteger(numeric)) return String(numeric);
  return numeric.toFixed(decimals).replace(/\.0$/, "");
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

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getProductCacheKey(product) {
  return `${product.code || "unknown"}::${product.product_name || "unknown"}`;
}

function calculateScaledValue(valuePer100g, grams) {
  const numeric = safeNumber(valuePer100g);
  if (numeric === null) return null;
  return (numeric / 100) * grams;
}

/* ----------------------------- */
/* Food exchange logic           */
/* ----------------------------- */

function getFoodCategory(food) {
  const protein = safeNumber(food.protein) || 0;
  const carbs = safeNumber(food.carbs) || 0;
  const fat = safeNumber(food.fat) || 0;

  const macros = [
    { key: "protein", value: protein, label: "Protein" },
    { key: "carbs", value: carbs, label: "Carb" },
    { key: "fat", value: fat, label: "Fat" }
  ].sort((a, b) => b.value - a.value);

  const dominant = macros[0];
  const runnerUp = macros[1];

  if (dominant.value <= 0) {
    return {
      key: null,
      label: "Mixed",
      confidence: "none"
    };
  }

  if (runnerUp.value === 0 || dominant.value >= runnerUp.value * DOMINANCE_RATIO) {
    return {
      key: dominant.key,
      label: dominant.label,
      confidence: "dominant"
    };
  }

  return {
    key: dominant.key,
    label: `${dominant.label} (mixed)`,
    confidence: "mixed"
  };
}

function calculatePortionSize(food) {
  const category = getFoodCategory(food);

  if (!category.key) {
    return {
      portionGrams: null,
      category,
      reason: "No usable macro values"
    };
  }

  const macroValue = safeNumber(food[category.key]);

  if (macroValue === null || macroValue <= 0) {
    return {
      portionGrams: null,
      category,
      reason: "Dominant macro missing or zero"
    };
  }

  const target = EXCHANGE_TARGETS[category.key];
  const rawPortionGrams = (target / macroValue) * 100;
  const portionGrams = clamp(rawPortionGrams, MIN_PORTION_GRAMS, MAX_PORTION_GRAMS);

  return {
    portionGrams,
    rawPortionGrams,
    category,
    target,
    wasClamped: portionGrams !== rawPortionGrams
  };
}

function calculatePerPortionValues(food) {
  const portionInfo = calculatePortionSize(food);

  if (!portionInfo.portionGrams) {
    return {
      portionInfo,
      values: null
    };
  }

  const grams = portionInfo.portionGrams;

  return {
    portionInfo,
    values: {
      kcal: calculateScaledValue(food.kcal, grams),
      fat: calculateScaledValue(food.fat, grams),
      carbs: calculateScaledValue(food.carbs, grams),
      protein: calculateScaledValue(food.protein, grams),
      fiber: calculateScaledValue(food.fiber, grams),
      sodium: calculateScaledValue(food.sodium, grams)
    }
  };
}

function getComputedNutritionView(product) {
  const cacheKey = getProductCacheKey(product);

  if (portionCache.has(cacheKey)) {
    return portionCache.get(cacheKey);
  }

  const computed = calculatePerPortionValues(product);
  portionCache.set(cacheKey, computed);
  return computed;
}

function getDisplayValues(product) {
  if (currentViewMode === "100g") {
    return {
      mode: "100g",
      label: "Per 100 g",
      pill: "Per 100 g view",
      portionInfo: null,
      values: {
        kcal: safeNumber(product.kcal),
        fat: safeNumber(product.fat),
        carbs: safeNumber(product.carbs),
        protein: safeNumber(product.protein),
        fiber: safeNumber(product.fiber),
        sodium: safeNumber(product.sodium)
      }
    };
  }

  const computed = getComputedNutritionView(product);

  if (!computed.values || !computed.portionInfo.portionGrams) {
    return {
      mode: "portion",
      label: "Per portion",
      pill: "Per portion view",
      portionInfo: computed.portionInfo,
      values: null
    };
  }

  return {
    mode: "portion",
    label: "Per portion",
    pill: "Per portion view",
    portionInfo: computed.portionInfo,
    values: computed.values
  };
}

function renderPortionSummary(displayData) {
  if (displayData.mode !== "portion") return "";

  const portionInfo = displayData.portionInfo;

  if (!portionInfo || !portionInfo.portionGrams) {
    return `
      <div class="portion-summary">
        <strong>Portion unavailable.</strong>
        <div class="portion-note">This food does not have enough macro data to calculate a reliable exchange portion.</div>
      </div>
    `;
  }

  const macroTypeLabel = `${portionInfo.category.label} portion`;
  const clampedNote = portionInfo.wasClamped
    ? `<div class="portion-note">Portion size was capped to keep the serving within a practical display range.</div>`
    : "";

  return `
    <div class="portion-summary">
      <strong>1 portion = ${formatNumber(portionInfo.portionGrams, 1)} g</strong><br>
      Exchange type: ${escapeHtml(macroTypeLabel)}<br>
      Based on target: ${formatNumber(portionInfo.target, 1)} g ${escapeHtml(portionInfo.category.key)}
      ${clampedNote}
    </div>
  `;
}

function updateViewToggleUi() {
  if (view100gBtn) {
    view100gBtn.classList.toggle("active", currentViewMode === "100g");
  }

  if (viewPortionBtn) {
    viewPortionBtn.classList.toggle("active", currentViewMode === "portion");
  }

  if (viewModePill) {
    viewModePill.textContent = currentViewMode === "100g" ? "Per 100 g view" : "Per portion view";
  }
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
/* Macro alternatives logic      */
/* ----------------------------- */

function overallMacroDistance(baseItem, candidate) {
  const baseKcal = safeNumber(baseItem.kcal);
  const baseFat = safeNumber(baseItem.fat);
  const baseCarbs = safeNumber(baseItem.carbs);
  const baseProtein = safeNumber(baseItem.protein);

  const candKcal = safeNumber(candidate.kcal);
  const candFat = safeNumber(candidate.fat);
  const candCarbs = safeNumber(candidate.carbs);
  const candProtein = safeNumber(candidate.protein);

  let distance = 0;

  if (baseKcal !== null && candKcal !== null) distance += Math.abs(baseKcal - candKcal) * 0.08;
  if (baseFat !== null && candFat !== null) distance += Math.abs(baseFat - candFat) * 1.0;
  if (baseCarbs !== null && candCarbs !== null) distance += Math.abs(baseCarbs - candCarbs) * 1.0;
  if (baseProtein !== null && candProtein !== null) distance += Math.abs(baseProtein - candProtein) * 1.2;

  return distance;
}

function macroSpecificDistance(baseItem, candidate, macroKey) {
  const baseValue = safeNumber(baseItem[macroKey]);
  const candidateValue = safeNumber(candidate[macroKey]);

  if (baseValue === null || candidateValue === null) return Number.POSITIVE_INFINITY;

  const primaryDistance = Math.abs(baseValue - candidateValue);
  const secondaryDistance = overallMacroDistance(baseItem, candidate);

  return (primaryDistance * 5) + secondaryDistance;
}

function getMacroAlternatives(baseItem, macroKey, maxItems = 10) {
  if (!baseItem || !Array.isArray(currentDetailsChunk) || currentDetailsChunk.length === 0) {
    return [];
  }

  const seenNames = new Set();

  const sameGroupCandidates = currentDetailsChunk
    .filter((item) => item.code !== baseItem.code)
    .filter((item) => item.product_name && item.product_name.trim() !== "")
    .filter((item) => item.group === baseItem.group)
    .filter((item) => safeNumber(item[macroKey]) !== null)
    .filter((item) => {
      const normalized = item.product_name.trim().toLowerCase();
      if (normalized === baseItem.product_name.trim().toLowerCase()) return false;
      if (seenNames.has(normalized)) return false;
      seenNames.add(normalized);
      return true;
    })
    .map((item) => ({
      ...item,
      distance: macroSpecificDistance(baseItem, item, macroKey)
    }))
    .sort((a, b) => a.distance - b.distance);

  if (sameGroupCandidates.length < 5) {
    const sameGroupNames = new Set(sameGroupCandidates.map((item) => item.product_name.trim().toLowerCase()));

    const fallbackCandidates = currentDetailsChunk
      .filter((item) => item.code !== baseItem.code)
      .filter((item) => item.product_name && item.product_name.trim() !== "")
      .filter((item) => safeNumber(item[macroKey]) !== null)
      .filter((item) => {
        const normalized = item.product_name.trim().toLowerCase();
        if (normalized === baseItem.product_name.trim().toLowerCase()) return false;
        if (sameGroupNames.has(normalized)) return false;
        return true;
      })
      .map((item) => ({
        ...item,
        distance: macroSpecificDistance(baseItem, item, macroKey)
      }))
      .sort((a, b) => a.distance - b.distance);

    return [...sameGroupCandidates, ...fallbackCandidates].slice(0, maxItems);
  }

  return sameGroupCandidates.slice(0, maxItems);
}

function renderAlternativeList(title, macroKey, baseItem) {
  const items = getMacroAlternatives(baseItem, macroKey, 10);

  if (!items.length) {
    return `
      <p class="small"><strong>${title}:</strong> No suitable matches found.</p>
    `;
  }

  const links = items
    .map((item) => {
      return `
        <a href="#" class="alt-link" data-code="${escapeHtml(item.code)}" data-chunk="${escapeHtml(currentChunkName)}">
          ${escapeHtml(item.product_name)}
        </a>
      `;
    })
    .join(" • ");

  return `
    <p class="small"><strong>${title}:</strong> ${links}</p>
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
  const proteinAlternatives = renderAlternativeList("Alternative Protein", "protein", product);
  const carbsAlternatives = renderAlternativeList("Alternative Carbs", "carbs", product);
  const fatAlternatives = renderAlternativeList("Alternative Fat", "fat", product);

  const displayData = getDisplayValues(product);
  const values = displayData.values;

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

      ${renderPortionSummary(displayData)}

      <div class="grid">
        <div><strong>Energy</strong><br>${values ? formatValue(values.kcal, " kcal") : "—"}</div>
        <div><strong>Fat</strong><br>${values ? formatValue(values.fat, " g") : "—"}</div>
        <div><strong>Carbohydrates</strong><br>${values ? formatValue(values.carbs, " g") : "—"}</div>
        <div><strong>Protein</strong><br>${values ? formatValue(values.protein, " g") : "—"}</div>
        <div><strong>Fiber</strong><br>${values ? formatValue(values.fiber, " g") : "—"}</div>
        <div><strong>Sodium</strong><br>${values ? formatValue(values.sodium, " g") : "—"}</div>
      </div>

      <p class="small">
        <strong>Display:</strong> ${escapeHtml(displayData.label)}
        ${displayData.mode === "100g" ? ` | <strong>Unit:</strong> ${escapeHtml(product.unit || "g")} | <strong>Qty:</strong> ${product.qty ?? 100}` : ""}
      </p>

      <p class="small"><strong>Notes:</strong> ${escapeHtml(product.notes || "—")}</p>

      ${proteinAlternatives}
      ${carbsAlternatives}
      ${fatAlternatives}
    </article>
  `;

  updateViewToggleUi();
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

function setViewMode(mode) {
  if (mode !== "100g" && mode !== "portion") return;

  currentViewMode = mode;
  updateViewToggleUi();

  if (currentProduct) {
    renderProduct(currentProduct);
  }
}

searchInput.addEventListener("input", handleSearchInput);
typeFilter.addEventListener("change", handleSearchInput);

if (view100gBtn) {
  view100gBtn.addEventListener("click", () => setViewMode("100g"));
}

if (viewPortionBtn) {
  viewPortionBtn.addEventListener("click", () => setViewMode("portion"));
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".search-wrapper")) {
    suggestionsList.style.display = "none";
  }
});

updateViewToggleUi();
