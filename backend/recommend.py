import numpy as np
import torch
import re


def build_user_vector(user_input, scaler):
    f = user_input

    x = np.array([[
        f["bedrooms"],
        f["bathrooms"],
        f["cats_ok"],
        f["dogs_ok"],
        f["cafes_nearby"],
        f["minutes_to_closest_cafe"],
        f["restaurants_nearby"],
        f["minutes_to_closest_restaurant"],
        f["shops_nearby"],
        f["minutes_to_nearest_bus_stop"],
        f["minutes_to_nearest_t_station"],
        f["parks_nearby"],
        f["minutes_to_closest_drugstore"],
        f["minutes_to_closest_urgent_care"]
    ]])

    x_scaled = scaler.transform(x)
    return torch.tensor(x_scaled, dtype=torch.float32)


def get_user_embedding(model, x_tensor):
    model.eval()
    with torch.no_grad():
        emb = model.feature_extractor(x_tensor)
        return emb.cpu().numpy()[0]


def parse_coord(coord_str):
    if isinstance(coord_str, float) and np.isnan(coord_str):
        return None

    pattern = r"([0-9.]+)°\s*([NS])\s*([0-9.]+)°\s*([EW])"
    match = re.match(pattern, coord_str)

    if not match:
        return None

    lat = float(match.group(1))
    lat_dir = match.group(2)
    lon = float(match.group(3))
    lon_dir = match.group(4)

    if lat_dir == "S":
        lat *= -1
    if lon_dir == "W":
        lon *= -1

    return np.array([lat, lon])


def haversine(lat1, lon1, lat2, lon2):
    R = 6371

    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    c = 2 * np.arcsin(np.sqrt(a))

    return R * c


def cosine_sim(a, B):
    a = a / (np.linalg.norm(a) + 1e-8)
    B = B / (np.linalg.norm(B, axis=1, keepdims=True) + 1e-8)
    return B @ a


def compute_scores(user_emb, user_location, embeddings, df, lambda_geo=0.1):

    sim_scores = cosine_sim(user_emb, embeddings)

    if user_location is None:
        return sim_scores

    user_lat = user_location["latitude"]
    user_lon = user_location["longitude"]

    geo_scores = np.zeros(len(df))

    for i, coord in enumerate(df["Coordinates"]):
        parsed = parse_coord(coord)
        if parsed is None:
            geo_scores[i] = 0
            continue

        lat, lon = parsed
        geo_scores[i] = haversine(user_lat, user_lon, lat, lon)

    geo_scores = (geo_scores - geo_scores.min()) / (geo_scores.max() - geo_scores.min() + 1e-8)

    final_scores = sim_scores - lambda_geo * geo_scores

    return final_scores


def get_top_k(scores, k=5):
    return np.argsort(scores)[::-1][:k]


def format_output(df, indices, scores):
    neighbors = []

    for rank, i in enumerate(indices):
        row = df.iloc[i]

        neighbors.append({
            "rank": rank + 1,
            "score": float(scores[i]),
            "Address": row["Address"],
            "Coordinates": row["Coordinates"],
            "City": row["City"],
            "# Bedrooms": row["# Bedrooms"],
            "# Bathrooms": row["# Bathrooms"],
            "Price per bedroom": row["Price per bedroom"],
            "Price per apartment": row["Price per apartment"],
            "Cats ok": row["Cats ok"],
            "Dogs ok": row["Dogs ok"],
            "# cafes nearby": row["# cafes nearby"],
            "# minutes to closest cafe": row["# minutes to closest cafe"],
            "# restaurants nearby": row["# restaurants nearby"],
            "# minutes to closest restaurant": row["# minutes to closest restaurant"],
            "# shops nearby": row["# shops nearby"],
            "# minutes to nearest bus stop": row["# minutes to nearest bus stop"],
            "# minutes to nearest T-station": row["# minutes to nearest T-station"],
            "# parks nearby": row["# parks nearby"],
            "# minutes to closest drugstore": row["# minutes to closest drugstore"],
            "# minutes to closest urgent care": row["# minutes to closest urgent care"]
        })

    return {"neighbors": neighbors}