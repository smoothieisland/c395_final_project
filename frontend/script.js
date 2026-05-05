// =============================================================
//  VibeMe — frontend logic
// -------------------------------------------------------------
//  - Reads the search form
//  - Geocodes city + zip → lat/lon (free Nominatim API, no key)
//  - Builds a payload that matches the shape of recommendation_sample.json
//  - POSTs it to the backend at API_URL
//  - On any failure (network, 4xx/5xx, missing backend), falls back
//    to a built-in mock list of 5 sample addresses so the UI is
//    fully demoable today.
//  - Renders 5 cards with photos; clicking one opens a detail modal.
// =============================================================

// ---- Config -------------------------------------------------
// Change this when the backend is live. The backend should accept
// a POST with the JSON below and return { neighbors: [...] }.
const API_URL = "http://localhost:8000/recommend";

// Nominatim — OSM's free geocoder. Per their usage policy we add
// a descriptive User-Agent via the Referer (browsers can't set UA),
// and we keep traffic light (one call per search).
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search";

// ---- DOM refs -----------------------------------------------
const form         = document.getElementById("search-form");
const statusEl     = document.getElementById("form-status");
const searchBtn    = document.getElementById("search-btn");
const emptyEl      = document.getElementById("results-empty");
const loadingEl    = document.getElementById("results-loading");
const errorEl      = document.getElementById("results-error");
const gridEl       = document.getElementById("results-grid");
const modal        = document.getElementById("detail-modal");
const modalBody    = document.getElementById("modal-body");

// =============================================================
//  Form handling
// =============================================================
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runSearch();
});

async function runSearch() {
  setUiState("loading");
  searchBtn.disabled = true;
  statusEl.textContent = "";

  // 1. Read form values
  const city = document.getElementById("city").value.trim();
  const zip  = document.getElementById("zip").value.trim();

  if (!city || !zip) {
    statusEl.textContent = "Please enter both a city and a zip code.";
    setUiState("empty");
    searchBtn.disabled = false;
    return;
  }

  // 2. Geocode city + zip → lat/lon
  let coords;
  try {
    statusEl.textContent = "Looking up location…";
    coords = await geocode(city, zip);
  } catch (err) {
    console.warn("Geocoding failed:", err);
    statusEl.textContent = "Couldn't find that location, using approximate coordinates.";
    // Fallback: a Cambridge, MA-ish lat/lon, like the sample JSON
    coords = { latitude: 42.3736, longitude: -71.1097 };
  }

  // 3. Build payload that matches recommendation_sample.json
  const payload = buildPayload(coords);

  console.log("Sending payload to backend:", payload);
  statusEl.textContent = "Searching…";

  // 4. POST to backend (with mock fallback). Both paths return the
  //    raw backend shape — we normalize once below.
  let neighbors;
  try {
    neighbors = await fetchRecommendations(payload);
    statusEl.textContent = `Found ${neighbors.length} matches.`;
  } catch (err) {
    console.warn("Backend call failed, using mock data:", err);
    neighbors = getMockNeighbors();
    statusEl.textContent = "Backend unavailable — showing sample matches.";
  }

  // 5. Normalize and render
  const results = neighbors.map(normalize);
  renderResults(results);
  searchBtn.disabled = false;
}

// =============================================================
//  Geocoding (city + zip → lat/lon)
// =============================================================
async function geocode(city, zip) {
  // Nominatim accepts structured queries; "postalcode" + "city" works well in the US.
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("city", city);
  url.searchParams.set("postalcode", zip);
  url.searchParams.set("country", "USA");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);

  const data = await res.json();
  if (!data.length) throw new Error("No results from geocoder");

  return {
    latitude:  parseFloat(data[0].lat),
    longitude: parseFloat(data[0].lon),
  };
}

// =============================================================
//  Build the payload (same shape as recommendation_sample.json)
// =============================================================
function buildPayload(coords) {
  const num = (id) => Number(document.getElementById(id).value || 0);
  const bool01 = (id) => document.getElementById(id).checked ? 1 : 0;

  return {
    filters: {
      min_bedrooms:     num("min_bedrooms"),
      max_bedrooms:     num("max_bedrooms"),
      min_bathrooms:    num("min_bathrooms"),
      max_bathrooms:    num("max_bathrooms"),
      require_cats_ok:  bool01("require_cats_ok"),
      require_dogs_ok:  bool01("require_dogs_ok"),
    },
    location: {
      latitude:  coords.latitude,
      longitude: coords.longitude,
    },
    features: {
      bedrooms:                          num("bedrooms"),
      bathrooms:                         num("bathrooms"),

      cats_ok:                           bool01("require_cats_ok"),
      dogs_ok:                           bool01("require_dogs_ok"),

      cafes_nearby:                      num("cafes_nearby"),
      minutes_to_closest_cafe:           num("minutes_to_closest_cafe"),

      restaurants_nearby:                num("restaurants_nearby"),
      minutes_to_closest_restaurant:     num("minutes_to_closest_restaurant"),

      shops_nearby:                      num("shops_nearby"),
      minutes_to_nearest_bus_stop:       num("minutes_to_nearest_bus_stop"),
      minutes_to_nearest_t_station:      num("minutes_to_nearest_t_station"),

      parks_nearby:                      num("parks_nearby"),
      minutes_to_closest_drugstore:      num("minutes_to_closest_drugstore"),
      minutes_to_closest_urgent_care:    num("minutes_to_closest_urgent_care"),
    },
  };
}

// =============================================================
//  Backend call — returns the raw `neighbors` array
// =============================================================
async function fetchRecommendations(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Backend responded ${res.status}`);

  const data = await res.json();
  // Expected shape:
  // { neighbors: [ { rank, distance, "Address", "City", "# Bedrooms", ... } ] }
  if (!data || !Array.isArray(data.neighbors)) {
    throw new Error("Backend returned unexpected shape (missing `neighbors`)");
  }
  return data.neighbors.slice(0, 5);
}

// =============================================================
//  Normalize backend shape → clean internal model
// -------------------------------------------------------------
//  The backend returns keys with spaces and `#` prefixes. This is
//  awkward to use in the rendering code, so we map every record
//  through this function exactly once. If the backend's shape
//  changes, this is the only place to update.
// =============================================================
function normalize(n) {
  // Convert "$1500" → 1500 (number) for tidy formatting; fall back to original string if not parseable.
  const parseDollars = (v) => {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return null;
    const cleaned = v.replace(/[^0-9.]/g, "");
    return cleaned ? Number(cleaned) : null;
  };

  // Distance ∈ [0, ∞) where lower = better match. Convert to a 0–100% "match score"
  // bounded at 1.0. With the sample distances 0.38–0.61 this gives 62%–39%.
  const distance = typeof n.distance === "number" ? n.distance : null;
  const matchPct =
    distance != null ? Math.max(0, Math.round((1 - Math.min(distance, 1)) * 100)) : null;

  // No image is provided — generate a stable placeholder per address.
  const seed = encodeURIComponent(`vibeme-${n.rank ?? ""}-${n.Address ?? "addr"}`);
  const imageUrl = `https://picsum.photos/seed/${seed}/640/480`;

  return {
    id:            `${n.rank ?? ""}-${n.Address ?? ""}`,
    rank:          n.rank ?? null,
    distance,
    match_pct:     matchPct,
    address:       n.Address ?? "",
    city:          n.City ?? "",
    coordinates:   n.Coordinates ?? "",
    bedrooms:      n["# Bedrooms"]  ?? null,
    bathrooms:     n["# Bathrooms"] ?? null,
    price_per_apartment: parseDollars(n["Price per apartment"]),
    price_per_bedroom:   parseDollars(n["Price per bedroom"]),
    cats_ok:       n["Cats ok"] ?? 0,
    dogs_ok:       n["Dogs ok"] ?? 0,
    image_url:     imageUrl,
    features: {
      cafes_nearby:                   n["# cafes nearby"]                   ?? null,
      minutes_to_closest_cafe:        n["# minutes to closest cafe"]        ?? null,
      restaurants_nearby:             n["# restaurants nearby"]             ?? null,
      minutes_to_closest_restaurant:  n["# minutes to closest restaurant"]  ?? null,
      shops_nearby:                   n["# shops nearby"]                   ?? null,
      parks_nearby:                   n["# parks nearby"]                   ?? null,
      minutes_to_nearest_bus_stop:    n["# minutes to nearest bus stop"]    ?? null,
      minutes_to_nearest_t_station:   n["# minutes to nearest T-station"]   ?? null,
      minutes_to_closest_drugstore:   n["# minutes to closest drugstore"]   ?? null,
      minutes_to_closest_urgent_care: n["# minutes to closest urgent care"] ?? null,
    },
  };
}

// =============================================================
//  Mock data (used when the backend is unreachable)
// -------------------------------------------------------------
//  Returns objects in the *exact* backend shape so the same
//  normalize() pipeline runs in both real and mock paths.
// =============================================================
function getMockNeighbors() {
  return [
    {
      "rank": 1, "distance": 0.38,
      "Address": "123 Main St", "Coordinates": "42.3888° N 71.0981° W", "City": "Cambridge",
      "# Bedrooms": 2, "# Bathrooms": 1,
      "Price per bedroom": "$1500", "Price per apartment": 3000,
      "Cats ok": 1, "Dogs ok": 0,
      "# cafes nearby": 5,  "# minutes to closest cafe": 3,
      "# restaurants nearby": 12, "# minutes to closest restaurant": 2,
      "# shops nearby": 8,
      "# minutes to nearest bus stop": 4, "# minutes to nearest T-station": 6,
      "# parks nearby": 2,
      "# minutes to closest drugstore": 5, "# minutes to closest urgent care": 10,
    },
    {
      "rank": 2, "distance": 0.44,
      "Address": "45 Elm St", "Coordinates": "42.3888° N 71.0981° W", "City": "Somerville",
      "# Bedrooms": 2, "# Bathrooms": 1,
      "Price per bedroom": "$1600", "Price per apartment": 3200,
      "Cats ok": 1, "Dogs ok": 1,
      "# cafes nearby": 4,  "# minutes to closest cafe": 4,
      "# restaurants nearby": 10, "# minutes to closest restaurant": 3,
      "# shops nearby": 7,
      "# minutes to nearest bus stop": 3, "# minutes to nearest T-station": 7,
      "# parks nearby": 1,
      "# minutes to closest drugstore": 6, "# minutes to closest urgent care": 12,
    },
    {
      "rank": 3, "distance": 0.49,
      "Address": "78 Broadway", "Coordinates": "42.3888° N 71.0981° W", "City": "Cambridge",
      "# Bedrooms": 2, "# Bathrooms": 1,
      "Price per bedroom": "$1550", "Price per apartment": 3100,
      "Cats ok": 1, "Dogs ok": 1,
      "# cafes nearby": 6,  "# minutes to closest cafe": 2,
      "# restaurants nearby": 14, "# minutes to closest restaurant": 2,
      "# shops nearby": 9,
      "# minutes to nearest bus stop": 5, "# minutes to nearest T-station": 5,
      "# parks nearby": 3,
      "# minutes to closest drugstore": 4, "# minutes to closest urgent care": 9,
    },
    {
      "rank": 4, "distance": 0.55,
      "Address": "12 Highland Ave", "Coordinates": "42.3888° N 71.0981° W", "City": "Somerville",
      "# Bedrooms": 2, "# Bathrooms": 2,
      "Price per bedroom": "$1650", "Price per apartment": 3300,
      "Cats ok": 0, "Dogs ok": 1,
      "# cafes nearby": 3,  "# minutes to closest cafe": 5,
      "# restaurants nearby": 9,  "# minutes to closest restaurant": 4,
      "# shops nearby": 6,
      "# minutes to nearest bus stop": 2, "# minutes to nearest T-station": 8,
      "# parks nearby": 2,
      "# minutes to closest drugstore": 7, "# minutes to closest urgent care": 11,
    },
    {
      "rank": 5, "distance": 0.61,
      "Address": "200 Mass Ave", "Coordinates": "42.3888° N 71.0981° W", "City": "Cambridge",
      "# Bedrooms": 2, "# Bathrooms": 1,
      "Price per bedroom": "$1525", "Price per apartment": 3050,
      "Cats ok": 1, "Dogs ok": 0,
      "# cafes nearby": 7,  "# minutes to closest cafe": 2,
      "# restaurants nearby": 15, "# minutes to closest restaurant": 1,
      "# shops nearby": 10,
      "# minutes to nearest bus stop": 3, "# minutes to nearest T-station": 4,
      "# parks nearby": 2,
      "# minutes to closest drugstore": 5, "# minutes to closest urgent care": 8,
    },
  ];
}

// =============================================================
//  Rendering
// =============================================================
function renderResults(results) {
  if (!results.length) {
    setUiState("empty");
    emptyEl.querySelector("h2").textContent = "No matches found.";
    emptyEl.querySelector("p").textContent  = "Try widening your filters.";
    return;
  }

  gridEl.innerHTML = "";
  results.forEach((r) => {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;

    const photo = document.createElement("img");
    photo.className = "card__photo";
    photo.src = r.image_url;
    photo.alt = `Photo of ${r.address}`;
    photo.loading = "lazy";
    photo.onerror = () => { photo.src = "https://picsum.photos/seed/fallback/640/480"; };

    // Rank badge in the corner of the photo
    const rankBadge = document.createElement("span");
    rankBadge.className = "card__rank";
    rankBadge.textContent = r.rank != null ? `#${r.rank}` : "";

    const photoWrap = document.createElement("div");
    photoWrap.className = "card__photo-wrap";
    photoWrap.appendChild(photo);
    if (r.rank != null) photoWrap.appendChild(rankBadge);

    const body = document.createElement("div");
    body.className = "card__body";

    const addr = document.createElement("h3");
    addr.className = "card__address";
    addr.textContent = r.address;

    const cityLine = document.createElement("p");
    cityLine.className = "card__meta";
    cityLine.textContent = r.city || "";

    const meta = document.createElement("p");
    meta.className = "card__meta";
    const parts = [];
    if (r.bedrooms != null)            parts.push(`${r.bedrooms} bd`);
    if (r.bathrooms != null)           parts.push(`${r.bathrooms} ba`);
    if (r.price_per_apartment != null) parts.push(`$${r.price_per_apartment.toLocaleString()}/mo`);
    meta.textContent = parts.join(" · ");

    body.appendChild(addr);
    if (r.city) body.appendChild(cityLine);
    body.appendChild(meta);

    if (r.match_pct != null) {
      const score = document.createElement("span");
      score.className = "card__score";
      score.textContent = `${r.match_pct}% match`;
      body.appendChild(score);
    }

    card.appendChild(photoWrap);
    card.appendChild(body);

    card.addEventListener("click",   () => openDetail(r));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(r); }
    });

    gridEl.appendChild(card);
  });

  setUiState("results");
}

// =============================================================
//  Detail modal
// =============================================================
function openDetail(r) {
  const f = r.features || {};
  const yesNo = (v) => (v ? "Yes" : "No");
  const dollars = (v) => (v == null ? "—" : `$${v.toLocaleString()}`);

  modalBody.innerHTML = `
    <img class="detail__photo"
         src="${r.image_url}"
         alt="Photo of ${escapeHtml(r.address)}"
         onerror="this.src='https://picsum.photos/seed/fallback/1200/675'" />
    <div class="detail__body">
      <h2 id="modal-title" class="detail__address">${escapeHtml(r.address)}</h2>
      <p class="detail__sub">
        ${escapeHtml(r.city || "")}
        ${r.coordinates ? ` · ${escapeHtml(r.coordinates)}` : ""}
        ${r.rank != null ? ` · <strong>Rank #${r.rank}</strong>` : ""}
        ${r.match_pct != null ? ` · <strong>${r.match_pct}% match</strong>` : ""}
      </p>

      <h3 class="detail__section-title">Unit</h3>
      <ul class="detail__features">
        <li><span>Bedrooms</span><span>${r.bedrooms ?? "—"}</span></li>
        <li><span>Bathrooms</span><span>${r.bathrooms ?? "—"}</span></li>
        <li><span>Price / apartment</span><span>${dollars(r.price_per_apartment)}</span></li>
        <li><span>Price / bedroom</span><span>${dollars(r.price_per_bedroom)}</span></li>
        <li><span>Cats allowed</span><span>${yesNo(r.cats_ok)}</span></li>
        <li><span>Dogs allowed</span><span>${yesNo(r.dogs_ok)}</span></li>
        ${r.distance != null
          ? `<li><span>Match distance</span><span>${r.distance.toFixed(2)}</span></li>`
          : ""}
      </ul>

      <h3 class="detail__section-title">Neighborhood</h3>
      <ul class="detail__features">
        <li><span>Cafés nearby</span><span>${f.cafes_nearby ?? "—"}</span></li>
        <li><span>Min to closest café</span><span>${minLabel(f.minutes_to_closest_cafe)}</span></li>
        <li><span>Restaurants nearby</span><span>${f.restaurants_nearby ?? "—"}</span></li>
        <li><span>Min to closest restaurant</span><span>${minLabel(f.minutes_to_closest_restaurant)}</span></li>
        <li><span>Shops nearby</span><span>${f.shops_nearby ?? "—"}</span></li>
        <li><span>Parks nearby</span><span>${f.parks_nearby ?? "—"}</span></li>
        <li><span>Min to bus stop</span><span>${minLabel(f.minutes_to_nearest_bus_stop)}</span></li>
        <li><span>Min to T station</span><span>${minLabel(f.minutes_to_nearest_t_station)}</span></li>
        <li><span>Min to drugstore</span><span>${minLabel(f.minutes_to_closest_drugstore)}</span></li>
        <li><span>Min to urgent care</span><span>${minLabel(f.minutes_to_closest_urgent_care)}</span></li>
      </ul>
    </div>
  `;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  modal.classList.add("hidden");
  modalBody.innerHTML = "";
  document.body.style.overflow = "";
}

modal.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]")) closeDetail();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modal.classList.contains("hidden")) closeDetail();
});

// =============================================================
//  Helpers
// =============================================================
function setUiState(state) {
  emptyEl.classList.toggle("hidden",   state !== "empty");
  loadingEl.classList.toggle("hidden", state !== "loading");
  errorEl.classList.toggle("hidden",   state !== "error");
  gridEl.classList.toggle("hidden",    state !== "results");
}

function minLabel(v) {
  if (v == null) return "—";
  return `${v} min`;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
