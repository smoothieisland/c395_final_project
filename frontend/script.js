document.addEventListener("DOMContentLoaded", () => {
function render(items) {
  grid.innerHTML = "";

  if (!items || items.length === 0) {
    setState("empty");
    empty.textContent = "No matches found.";
    return;
  }

  items.forEach((i, idx) => {
    const div = document.createElement("div");
    div.className = "card";

    const imageUrl = makeImageUrl(i.Address, i.rank ?? idx);

    div.innerHTML = `
      <div style="position:relative;">
        <img 
          src="${imageUrl}" 
          style="width:100%;height:180px;object-fit:cover;border-radius:10px;" 
        />

        ${
          i.rank !== undefined
            ? `<span style="
                position:absolute;
                top:8px;
                left:8px;
                background:black;
                color:white;
                padding:4px 8px;
                border-radius:6px;
                font-size:12px;
              ">#${i.rank}</span>`
            : ""
        }
      </div>

      <h3 style="margin:10px 0 5px 0;">
        ${i.Address || "Unknown address"}
      </h3>

      <p style="margin:0;color:#555;">
        ${i.City || ""}
      </p>

      <p style="margin:6px 0;">
        ${i["# Bedrooms"] ?? "—"} bd / ${i["# Bathrooms"] ?? "—"} ba
      </p>

      <p style="font-weight:600;">
        $${i["Price per apartment"]
          ? Number(i["Price per apartment"]).toLocaleString()
          : "—"}
      </p>
    `;

    div.addEventListener("click", () => openDetail(i));

    grid.appendChild(div);
  });
}
function openDetail(i) {
  modalBody.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">

      <h2>${i.Address}</h2>

      <p><strong>City:</strong> ${i.City ?? "-"}</p>
      <p><strong>Coordinates:</strong> ${i.Coordinates ?? "-"}</p>

      <hr/>

      <h3>Unit Info</h3>
      <p><strong>Bedrooms:</strong> ${i["# Bedrooms"] ?? "-"}</p>
      <p><strong>Bathrooms:</strong> ${i["# Bathrooms"] ?? "-"}</p>

      <p><strong>Price:</strong> $${i["Price per apartment"] ?? "-"}</p>
      <p><strong>Price / bedroom:</strong> ${i["Price per bedroom"] ?? "-"}</p>

      <hr/>

      <h3>Pet Policy</h3>
      <p><strong>Cats ok:</strong> ${i["Cats ok"] ? "Yes" : "No"}</p>
      <p><strong>Dogs ok:</strong> ${i["Dogs ok"] ? "Yes" : "No"}</p>

      <hr/>

      <h3>Lifestyle Features</h3>

      <p><strong>Cafes nearby:</strong> ${i["# cafes nearby"] ?? "-"}</p>
      <p><strong>Minutes to closest cafe:</strong> ${i["# minutes to closest cafe"] ?? "-"}</p>

      <p><strong>Restaurants nearby:</strong> ${i["# restaurants nearby"] ?? "-"}</p>
      <p><strong>Minutes to closest restaurant:</strong> ${i["# minutes to closest restaurant"] ?? "-"}</p>

      <p><strong>Shops nearby:</strong> ${i["# shops nearby"] ?? "-"}</p>
      <p><strong>Parks nearby:</strong> ${i["# parks nearby"] ?? "-"}</p>

      <hr/>

      <h3>Transit & Essentials</h3>

      <p><strong>Minutes to nearest bus stop:</strong> ${i["# minutes to nearest bus stop"] ?? "-"}</p>
      <p><strong>Minutes to nearest T-station:</strong> ${i["# minutes to nearest T-station"] ?? "-"}</p>

      <p><strong>Minutes to closest drugstore:</strong> ${i["# minutes to closest drugstore"] ?? "-"}</p>
      <p><strong>Minutes to closest urgent care:</strong> ${i["# minutes to closest urgent care"] ?? "-"}</p>

    </div>
  `;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
// =============================================================
// TRAINING MEAN INITIALIZATION
// =============================================================

let FEATURE_MEANS = {};

async function loadFeatureMeans() {
  try {
    const res = await fetch("http://localhost:8000/feature-means");
    FEATURE_MEANS = await res.json();

    setDefaults();
  } catch (err) {
    console.warn("Could not load feature means:", err);
  }
}

// =============================================================
// DEFAULT POPULATION (UPDATED RULES)
// =============================================================
// ONLY fills:
//   - cafes / restaurants / shops / parks
//   - all "minutes_to_*"
// DOES NOT fill:
//   - bedrooms
//   - bathrooms
//   - cats/dogs
// =============================================================
function setDefaults() {

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el || val == null) return;
    el.value = Math.round(val);
  };

  // ---------------------------
  // DO NOT TOUCH (intentionally empty)
  // ---------------------------
  // bedrooms, bathrooms, cats, dogs → user input only

  // ---------------------------
  // LIFESTYLE COUNTS
  // ---------------------------
  set("cafes_nearby", FEATURE_MEANS["# cafes nearby"]);
  set("restaurants_nearby", FEATURE_MEANS["# restaurants nearby"]);
  set("shops_nearby", FEATURE_MEANS["# shops nearby"]);
  set("parks_nearby", FEATURE_MEANS["# parks nearby"]);

  // ---------------------------
  // TRAVEL TIMES
  // ---------------------------
  set("minutes_to_closest_cafe", FEATURE_MEANS["# minutes to closest cafe"]);
  set("minutes_to_closest_restaurant", FEATURE_MEANS["# minutes to closest restaurant"]);

  set("minutes_to_nearest_bus_stop", FEATURE_MEANS["# minutes to nearest bus stop"]);
  set("minutes_to_nearest_t_station", FEATURE_MEANS["# minutes to nearest T-station"]);

  set("minutes_to_closest_drugstore", FEATURE_MEANS["# minutes to closest drugstore"]);
  set("minutes_to_closest_urgent_care", FEATURE_MEANS["# minutes to closest urgent care"]);
}

// =============================================================
// CONFIG
// =============================================================
const API_RECOMMEND = "http://localhost:8000/recommend";
const API_PREDICT   = "http://localhost:8000/predict";
const GEO_URL = "https://nominatim.openstreetmap.org/search";

// =============================================================
// DOM
// =============================================================

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

const modal = document.getElementById("detail-modal");
const modalBody = document.getElementById("modal-body");
// =============================================================
// MODAL CLOSE FIX (ADD THIS)
// =============================================================

// close when clicking backdrop OR any element with data-close-modal
modal.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]")) {
    closeModal();
  }
});

// ESC key support
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
  }
});

function closeModal() {
  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// =============================================================
// TAB SWITCH
// =============================================================
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

// =============================================================
// UI STATE
// =============================================================
function setState(state) {
  empty.classList.toggle("hidden", state !== "empty");
  loading.classList.toggle("hidden", state !== "loading");
  error.classList.toggle("hidden", state !== "error");
  grid.classList.toggle("hidden", state !== "results");
}

// =============================================================
// HELPERS
// =============================================================
const num = (id) => Number(document.getElementById(id)?.value || 0);
const bool01 = (id) => document.getElementById(id)?.checked ? 1 : 0;

function makeImageUrl(address, rank) {
  const seed = encodeURIComponent(`vibeme-${rank ?? ""}-${address ?? "addr"}`);
  return `https://picsum.photos/seed/${seed}/640/480`;
}

// =============================================================
// GEO
// =============================================================
async function geocode(city, zip) {
  const url = new URL(GEO_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("city", city);
  url.searchParams.set("postalcode", zip);

  const res = await fetch(url);
  const data = await res.json();

  if (!data.length) {
    return { latitude: 42.3736, longitude: -71.1097 };
  }

  return {
    latitude: parseFloat(data[0].lat),
    longitude: parseFloat(data[0].lon)
  };
}

// =============================================================
// RECOMMEND FEATURES
// =============================================================
function buildFeatures() {
  return {
    bedrooms: num("bedrooms"),
    bathrooms: num("bathrooms"),

    cats_ok: bool01("require_cats_ok"),
    dogs_ok: bool01("require_dogs_ok"),

    cafes_nearby: num("cafes_nearby"),
    restaurants_nearby: num("restaurants_nearby"),
    shops_nearby: num("shops_nearby"),
    parks_nearby: num("parks_nearby"),

    minutes_to_closest_cafe: num("minutes_to_closest_cafe"),
    minutes_to_closest_restaurant: num("minutes_to_closest_restaurant"),
    minutes_to_nearest_bus_stop: num("minutes_to_nearest_bus_stop"),
    minutes_to_nearest_t_station: num("minutes_to_nearest_t_station"),
    minutes_to_closest_drugstore: num("minutes_to_closest_drugstore"),
    minutes_to_closest_urgent_care: num("minutes_to_closest_urgent_care")
  };
}

// =============================================================
// RECOMMEND FLOW
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
// PREDICT FLOW (UNCHANGED)
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

        cafes_nearby: num("p_cafes_nearby"),
        minutes_to_closest_cafe: num("p_minutes_to_closest_cafe"),

        restaurants_nearby: num("p_restaurants_nearby"),
        minutes_to_closest_restaurant: num("p_minutes_to_closest_restaurant"),

        shops_nearby: num("p_shops_nearby"),
        parks_nearby: num("p_parks_nearby"),

        minutes_to_nearest_bus_stop: num("p_minutes_to_nearest_bus_stop"),
        minutes_to_nearest_t_station: num("p_minutes_to_nearest_t_station"),
        minutes_to_closest_drugstore: num("p_minutes_to_closest_drugstore"),
        minutes_to_closest_urgent_care: num("p_minutes_to_closest_urgent_care")
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
// INIT
// =============================================================
setState("empty");
loadFeatureMeans();

});