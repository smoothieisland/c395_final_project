import numpy as np
import pandas as pd
import torch
import joblib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from utils import FEATURE_COLS

from model import PriceModel
from recommend import (
    build_user_vector,
    get_user_embedding,
    compute_scores,
    format_output
)

from utils import TARGET_COL, clean_price

# -----------------------
# APP INIT (MUST BE FIRST)
# -----------------------
app = FastAPI()

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],  # or ["*"] for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------
# SAFE TYPE CONVERSION
# -----------------------
def to_py(x):
    if isinstance(x, (np.integer, np.int64)):
        return int(x)
    if isinstance(x, (np.floating, np.float64, np.float32)):
        return float(x)
    return x

# -----------------------
# LOAD DATA
# -----------------------
df = pd.read_csv("/Users/angelayuan/Documents/6.C385/apartment-price-app/data/c395_dataset.csv")
df = df.reset_index(drop=True)

df[TARGET_COL] = df[TARGET_COL].apply(clean_price)
df = df.dropna(subset=[TARGET_COL]).reset_index(drop=True)

# -----------------------
# LOAD EMBEDDINGS
# -----------------------
embeddings = np.load(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/train_embeddings.npy"
)

idx_map = np.load(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/train_indices.npy"
)

df = df.iloc[idx_map].reset_index(drop=True)

# -----------------------
# MODEL + SCALERS (LOAD ONCE)
# -----------------------
model = PriceModel(input_dim=14)
model.load_state_dict(
    torch.load(
        "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/model.pt",
        map_location="cpu"
    )
)
model.eval()

scaler = joblib.load(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/scaler.pkl"
)

target_scaler = joblib.load(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/target_scaler.pkl"
)

# -----------------------
# ROUTING
# -----------------------
def route_request(payload: dict):
    if "filters" in payload and "location" in payload:
        return "recommend"
    if "features" in payload:
        return "predict"
    return "invalid"

# -----------------------
# FILTERING
# -----------------------
def apply_filters(df, filters):
    out = df.copy()

    if filters.get("min_bedrooms") is not None:
        out = out[out["# Bedrooms"] >= filters["min_bedrooms"]]

    if filters.get("max_bedrooms") is not None:
        out = out[out["# Bedrooms"] <= filters["max_bedrooms"]]

    if filters.get("min_bathrooms") is not None:
        out = out[out["# Bathrooms"] >= filters["min_bathrooms"]]

    if filters.get("max_bathrooms") is not None:
        out = out[out["# Bathrooms"] <= filters["max_bathrooms"]]

    if filters.get("require_cats_ok") == 1:
        out = out[out["Cats ok"] == 1]

    if filters.get("require_dogs_ok") == 1:
        out = out[out["Dogs ok"] == 1]

    return out

# -----------------------
# PRICE PREDICTION
# -----------------------
FEATURE_MAP = {
    "# Bedrooms": "bedrooms",
    "# Bathrooms": "bathrooms",
    "Cats ok": "cats_ok",
    "Dogs ok": "dogs_ok",
    "# cafes nearby": "cafes_nearby",
    "# minutes to closest cafe": "minutes_to_closest_cafe",
    "# restaurants nearby": "restaurants_nearby",
    "# minutes to closest restaurant": "minutes_to_closest_restaurant",
    "# shops nearby": "shops_nearby",
    "# minutes to nearest bus stop": "minutes_to_nearest_bus_stop",
    "# minutes to nearest T-station": "minutes_to_nearest_t_station",
    "# parks nearby": "parks_nearby",
    "# minutes to closest drugstore": "minutes_to_closest_drugstore",
    "# minutes to closest urgent care": "minutes_to_closest_urgent_care"
}
def predict_price(user_features, model, scaler, target_scaler):

    x = np.array([[
        user_features[FEATURE_MAP[col]]
        for col in FEATURE_COLS
    ]])

    x_scaled = scaler.transform(x)
    x_tensor = torch.tensor(x_scaled, dtype=torch.float32)

    with torch.no_grad():
        pred = model(x_tensor).numpy()[0]

    price = pred * target_scaler["std"] + target_scaler["mean"]

    return float(price)

def extract_features(payload):
    features = payload.get("features", {})

    # enforce defaults so NOTHING ever KeyErrors again
    defaults = {
        "bedrooms": 0,
        "bathrooms": 0,
        "cats_ok": 0,
        "dogs_ok": 0,
        "cafes_nearby": 0,
        "minutes_to_closest_cafe": 0,
        "restaurants_nearby": 0,
        "minutes_to_closest_restaurant": 0,
        "shops_nearby": 0,
        "minutes_to_nearest_bus_stop": 0,
        "minutes_to_nearest_t_station": 0,
        "parks_nearby": 0,
        "minutes_to_closest_drugstore": 0,
        "minutes_to_closest_urgent_care": 0,
    }

    # merge safely
    return {**defaults, **features}
# -----------------------
# MAIN HANDLER
# -----------------------
def handle_request(payload: dict):

    task = route_request(payload)

    if task == "predict":
        features = extract_features(payload)

        price = predict_price(features, model, scaler, target_scaler)

        return {"predicted_price": price}


    # -----------------------
    # RECOMMENDATION FLOW
    # -----------------------
    filters = payload.get("filters", {})
    user_location = payload.get("location")
    user_features = extract_features(payload)

    if user_features is None:
        return {"error": "Missing features"}

    filtered_df = apply_filters(df, filters)

    if len(filtered_df) == 0:
        return {"neighbors": []}

    filtered_indices = filtered_df.index.to_numpy()

    filtered_embeddings = embeddings[filtered_indices]

    user_vec = build_user_vector(user_features, scaler)
    user_emb = get_user_embedding(model, user_vec)

    scores = compute_scores(
        user_emb,
        user_location,
        filtered_embeddings,
        filtered_df
    )

    top_k = np.argsort(scores)[:5]
    top_k = [int(i) for i in top_k]

    result = format_output(filtered_df, top_k, scores)

    for n in result["neighbors"]:
        for k, v in n.items():
            n[k] = to_py(v)

    return JSONResponse(content=result)

# -----------------------
# ROUTES
# -----------------------
@app.post("/recommend")
def recommend(payload: dict):
    return handle_request(payload)

@app.post("/predict")
def predict(payload: dict):
    return handle_request(payload)

@app.get("/feature-means")
def feature_means():
    means = {}

    for col in FEATURE_COLS:
        means[col] = float(df[col].mean())

    return JSONResponse(content=means)