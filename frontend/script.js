document.addEventListener("DOMContentLoaded", () => {

const API_RECOMMEND = "http://localhost:8000/recommend";
const API_PREDICT   = "http://localhost:8000/predict";
const GEO_URL = "https://nominatim.openstreetmap.org/search";

// ================= DOM =================
const recommendTab = document.getElementById("tab-recommend");
const predictTab = document.getElementById("tab-predict");

const recommendPanel = document.getElementById("recommend-panel");
const predictPanel = document.getElementById("predict-panel");

const form = document.getElementById("search-form");
const predictForm = document.getElementById("predict-form");

const statusEl = document.getElementById("form-status");
const predictStatus = document.getElementById("predict-status");

const grid = document.getElementById("results-grid");
const empty = document.getElementById("results-empty");
const loading = document.getElementById("results-loading");
const error = document.getElementById("results-error");

// ================= TAB SWITCH =================
recommendTab.onclick = () => {
  recommendTab.classList.add("active");
  predictTab.classList.remove("active");

  recommendPanel.classList.remove("hidden");
  predictPanel.classList.add("hidden");
};

predictTab.onclick = () => {
  predictTab.classList.add("active");
  recommendTab.classList.remove("active");

  predictPanel.classList.remove("hidden");
  recommendPanel.classList.add("hidden");
};

// ================= UI STATE =================
function setState(state) {
  empty.classList.toggle("hidden", state !== "empty");
  loading.classList.toggle("hidden", state !== "loading");
  error.classList.toggle("hidden", state !== "error");
  grid.classList.toggle("hidden", state !== "results");
}

function makeImageUrl(address, rank) {
  const seed = encodeURIComponent(`vibeme-${rank ?? ""}-${address ?? "addr"}`);
  return `https://picsum.photos/seed/${seed}/640/480`;
}

// ================= SAFE INPUT HELPERS =================
const num = (id) =>
  Number(document.getElementById(id)?.value ?? 0);

const bool01 = (id) =>
  document.getElementById(id)?.checked ? 1 : 0;

// ================= FULL 14-FEATURE VECTOR =================
function buildFeatures() {
  return {
    bedrooms: num("bedrooms"),
    bathrooms: num("bathrooms"),

    cats_ok: bool01("require_cats_ok"),
    dogs_ok: bool01("require_dogs_ok"),

    cafes_nearby: num("cafes_nearby"),
    minutes_to_closest_cafe: num("minutes_to_closest_cafe"),

    restaurants_nearby: num("restaurants_nearby"),
    minutes_to_closest_restaurant: num("minutes_to_closest_restaurant"),

    shops_nearby: num("shops_nearby"),

    parks_nearby: num("parks_nearby"),

    minutes_to_nearest_bus_stop: num("minutes_to_nearest_bus_stop"),
    minutes_to_nearest_t_station: num("minutes_to_nearest_t_station"),

    minutes_to_closest_drugstore: num("minutes_to_closest_drugstore"),
    minutes_to_closest_urgent_care: num("minutes_to_closest_urgent_care")
  };
}

// =============================================================
// RECOMMENDATION FLOW
// =============================================================
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setState("loading");
  statusEl.textContent = "";

  try {
    const city = document.getElementById("city").value.trim();
    const zip = document.getElementById("zip").value.trim();

    const coords = await geocode(city, zip);

    const payload = {
      location: coords,
      filters: {
        min_bedrooms: num("min_bedrooms"),
        max_bedrooms: num("max_bedrooms"),
        min_bathrooms: num("min_bathrooms"),
        max_bathrooms: num("max_bathrooms"),
        require_cats_ok: bool01("require_cats_ok"),
        require_dogs_ok: bool01("require_dogs_ok")
      },
      features: buildFeatures()
    };

    const res = await fetch(API_RECOMMEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Recommend failed");

    const data = await res.json();

    render(data.neighbors || []);
    setState("results");

    statusEl.textContent = `Found ${data.neighbors?.length || 0} matches`;

  } catch (err) {
    console.error(err);
    setState("error");
    statusEl.textContent = "Recommendation failed";
  }
});

// =============================================================
// PREDICT FLOW (STRICT 14-FEATURE INPUT)
// =============================================================
predictForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  predictStatus.textContent = "Predicting...";

  try {
    const payload = {
      features: {
        bedrooms: num("p-bedrooms"),
        bathrooms: num("p-bathrooms"),

        cats_ok: bool01("p-cats"),
        dogs_ok: bool01("p-dogs"),

        // FULL FEATURE VECTOR (must match backend model exactly)
        cafes_nearby: num("cafes_nearby"),
        minutes_to_closest_cafe: num("minutes_to_closest_cafe"),

        restaurants_nearby: num("restaurants_nearby"),
        minutes_to_closest_restaurant: num("minutes_to_closest_restaurant"),

        shops_nearby: num("shops_nearby"),
        parks_nearby: num("parks_nearby"),

        minutes_to_nearest_bus_stop: num("minutes_to_nearest_bus_stop"),
        minutes_to_nearest_t_station: num("minutes_to_nearest_t_station"),

        minutes_to_closest_drugstore: num("minutes_to_closest_drugstore"),
        minutes_to_closest_urgent_care: num("minutes_to_closest_urgent_care")
      }
    };

    const res = await fetch(API_PREDICT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error("Predict failed");

    const data = await res.json();

    grid.innerHTML = `
      <div class="card" style="padding:30px;text-align:center;">
        <h2>Predicted Rent</h2>
        <div style="font-size:32px;font-weight:bold;">
          $${Math.round(data.predicted_price).toLocaleString()}
        </div>
      </div>
    `;

    setState("results");
    predictStatus.textContent = "";

  } catch (err) {
    console.error(err);
    predictStatus.textContent = "Prediction failed";
  }
});

// =============================================================
// GEO (safe fallback added)
// =============================================================
async function geocode(city, zip) {
  const url = new URL(GEO_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("city", city);
  url.searchParams.set("postalcode", zip);

  const res = await fetch(url);
  const data = await res.json();

  if (!data.length) {
    return { latitude: 42.3736, longitude: -71.1097 }; // fallback (Cambridge)
  }

  return {
    latitude: parseFloat(data[0].lat),
    longitude: parseFloat(data[0].lon)
  };
}

// =============================================================
// RENDER RESULTS
// =============================================================
function render(items) {
  grid.innerHTML = "";

  items.forEach(i => {
    const div = document.createElement("div");
    div.className = "card";

    const imageUrl = makeImageUrl(i.Address, i.rank);

    div.innerHTML = `
      <div style="position:relative;">
        <img 
          src="${imageUrl}" 
          alt="Apartment photo"
          style="width:100%;height:180px;object-fit:cover;border-radius:10px;"
          onerror="this.src='https://picsum.photos/seed/fallback/640/480'"
        />
        ${i.rank ? `<span style="position:absolute;top:8px;left:8px;background:black;color:white;padding:4px 8px;border-radius:6px;font-size:12px;">#${i.rank}</span>` : ""}
      </div>

      <h3>${i.Address}</h3>
      <p>${i.City}</p>
      <p>${i["# Bedrooms"]} bd / ${i["# Bathrooms"]} ba</p>
      <p>$${i["Price per apartment"]}</p>
    `;

    grid.appendChild(div);
  });
}

// init
setState("empty");

});