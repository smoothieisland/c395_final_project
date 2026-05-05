import pandas as pd

FEATURE_COLS = [
    "# Bedrooms",
    "# Bathrooms",
    "Cats ok",
    "Dogs ok",
    "# cafes nearby",
    "# minutes to closest cafe",
    "# restaurants nearby",
    "# minutes to closest restaurant",
    "# shops nearby",
    "# minutes to nearest bus stop",
    "# minutes to nearest T-station",
    "# parks nearby",
    "# minutes to closest drugstore",
    "# minutes to closest urgent care"
]

TARGET_COL = "Price per apartment"

def clean_price(x):
    if pd.isna(x):
        return None
    return float(str(x).replace("$", "").replace(",", "").strip())

def load_and_clean_data(path, feature_cols, target_col):
    df = pd.read_csv(path)
    df = df.reset_index(drop=False)
    df.rename(columns={"index": "orig_index"}, inplace=True)

    df[target_col] = df[target_col].apply(clean_price)
    df = df.dropna(subset=[target_col])

    X = df[feature_cols].values
    y = df[target_col].values
    idx = df["orig_index"].values

    return df, X, y, idx