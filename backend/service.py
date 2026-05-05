import numpy as np
import pandas as pd
import torch
import joblib
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from model import PriceModel
from recommend import (
    build_user_vector,
    get_user_embedding,
    compute_scores,
    format_output
)

from utils import TARGET_COL, clean_price

app = FastAPI()

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
df = pd.read_csv(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/data/c395_dataset.csv"
)

df = df.reset_index(drop=True)

df[TARGET_COL] = df[TARGET_COL].apply(clean_price)
df = df.dropna(subset=[TARGET_COL]).reset_index(drop=True)

print(f"[DEBUG] full df size after cleaning: {len(df)}")


# -----------------------
# LOAD EMBEDDINGS
# -----------------------
embeddings = np.load(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/train_embeddings.npy"
)

idx_map = np.load(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/train_indices.npy"
)

print(f"[DEBUG] embeddings shape: {embeddings.shape}")
print(f"[DEBUG] idx_map size: {len(idx_map)}")

# ALIGN DATASET WITH EMBEDDINGS
df = df.iloc[idx_map].reset_index(drop=True)

print(f"[DEBUG] aligned df size: {len(df)}")


# -----------------------
# MODEL
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


# -----------------------
# ROUTING
# -----------------------
def route_request(payload: dict):
    if "filters" in payload:
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

    print(f"[DEBUG] filtered rows: {len(out)}")
    return out

def predict_price(user_features, model, scaler, target_scaler):
    import numpy as np
    import torch

    x = np.array([[
        user_features["bedrooms"],
        user_features["bathrooms"],
        user_features["cats_ok"],
        user_features["dogs_ok"],
        user_features["cafes_nearby"],
        user_features["minutes_to_closest_cafe"],
        user_features["restaurants_nearby"],
        user_features["minutes_to_closest_restaurant"],
        user_features["shops_nearby"],
        user_features["minutes_to_nearest_bus_stop"],
        user_features["minutes_to_nearest_t_station"],
        user_features["parks_nearby"],
        user_features["minutes_to_closest_drugstore"],
        user_features["minutes_to_closest_urgent_care"]
    ]])

    # scale input features
    x_scaled = scaler.transform(x)
    x_tensor = torch.tensor(x_scaled, dtype=torch.float32)

    model.eval()
    with torch.no_grad():
        pred = model(x_tensor).numpy()[0]

    # ----------------------------
    # FIX: inverse target scaling
    # ----------------------------
    mean = target_scaler["mean"]
    std = target_scaler["std"]

    price = pred * std + mean

    return float(price)
# -----------------------
# HANDLER
# -----------------------
def handle_request(payload: dict):

    task = route_request(payload)
    print("[DEBUG] task:", task)

    if task == "predict":
        user_features = payload.get("features")

        if user_features is None:
            return {"error": "Missing features for prediction"}

        target_scaler = joblib.load("/Users/angelayuan/Documents/6.C385/apartment-price-app/backend/saved/target_scaler.pkl")

        price = predict_price(
            user_features,
            model,
            scaler,
            target_scaler
        )

        return {
            "predicted_price": price
        }

    filters = payload.get("filters", {})
    user_location = payload.get("location")
    user_features = payload.get("features")

    print("[DEBUG] user_features present:", user_features is not None)
    print("[DEBUG] user_location:", user_location)

    if user_features is None:
        return {"error": "Missing features in request"}

    # -----------------------
    # FILTER STEP
    # -----------------------
    filtered_df = apply_filters(df, filters)

    if len(filtered_df) == 0:
        return {"neighbors": []}

    # -----------------------
    # SAFE EMBEDDING INDEXING
    # -----------------------
    filtered_indices = filtered_df.index.to_numpy()

    if filtered_indices.max() >= len(embeddings):
        return {
            "error": f"Index mismatch: max index {filtered_indices.max()} "
                     f"but embeddings size {len(embeddings)}"
        }

    filtered_embeddings = embeddings[filtered_indices]

    print(f"[DEBUG] filtered_embeddings shape: {filtered_embeddings.shape}")

    # -----------------------
    # USER EMBEDDING
    # -----------------------
    user_vec = build_user_vector(user_features, scaler)
    user_emb = get_user_embedding(model, user_vec)

    # -----------------------
    # SCORING
    # -----------------------
    scores = compute_scores(
        user_emb,
        user_location,
        filtered_embeddings,
        filtered_df
    )

    scores = np.asarray(scores, dtype=float)

    print(f"[DEBUG] scores shape: {scores.shape}")

    # -----------------------
    # TOP-K (SAFE)
    # -----------------------
    top_k = np.argsort(scores)[:5]
    top_k = [int(i) for i in top_k]

    print(f"[DEBUG] top_k: {top_k}")

    # -----------------------
    # FORMAT OUTPUT
    # -----------------------
    result = format_output(filtered_df, top_k, scores)

    # -----------------------
    # JSON SAFETY CLEANUP
    # -----------------------
    for n in result["neighbors"]:
        for k, v in n.items():
            n[k] = to_py(v)

    return JSONResponse(content=result)


# -----------------------
# API ENDPOINT
# -----------------------
@app.post("/route")
def route(payload: dict):
    return handle_request(payload)