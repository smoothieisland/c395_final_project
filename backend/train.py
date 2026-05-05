import random
import numpy as np
import torch

def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)

set_seed(42)
import torch.nn as nn
import torch.optim as optim
import pandas as pd
import joblib
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from model import PriceModel
from utils import FEATURE_COLS, TARGET_COL, clean_price, load_and_clean_data

df, X, y, idx = load_and_clean_data(
    "/Users/angelayuan/Documents/6.C385/apartment-price-app/data/c395_dataset.csv",
    FEATURE_COLS,
    TARGET_COL
)

X_train, X_temp, y_train, y_temp, idx_train, idx_temp = train_test_split(
    X, y, idx, test_size=0.3, random_state=42
)

X_val, X_test, y_val, y_test, idx_val, idx_test = train_test_split(
    X_temp, y_temp, idx_temp, test_size=0.5, random_state=42
)

scaler = StandardScaler()
X_train = scaler.fit_transform(X_train)
X_val = scaler.transform(X_val)
X_test = scaler.transform(X_test)

y_mean = y_train.mean()
y_std = y_train.std()

y_train = (y_train - y_mean) / y_std
y_val = (y_val - y_mean) / y_std
y_test = (y_test - y_mean) / y_std

X_train_tensor = torch.tensor(X_train, dtype=torch.float32)
y_train_tensor = torch.tensor(y_train, dtype=torch.float32).view(-1, 1)

X_val_tensor = torch.tensor(X_val, dtype=torch.float32)
y_val_tensor = torch.tensor(y_val, dtype=torch.float32).view(-1, 1)

X_test_tensor = torch.tensor(X_test, dtype=torch.float32)
y_test_tensor = torch.tensor(y_test, dtype=torch.float32).view(-1, 1)

model = PriceModel(X_train_tensor.shape[1])
criterion = nn.MSELoss()
optimizer = optim.Adam(model.parameters(), lr=1e-3)

for epoch in range(160):
    model.train()

    preds = model(X_train_tensor)
    loss = criterion(preds, y_train_tensor)

    optimizer.zero_grad()
    loss.backward()
    optimizer.step()

    if epoch % 10 == 0:
        model.eval()
        with torch.no_grad():
            val_preds = model(X_val_tensor)
            val_loss = criterion(val_preds, y_val_tensor)

        print(epoch, loss.item(), val_loss.item())

torch.save(model.state_dict(), "backend/saved/model.pt")
joblib.dump(scaler, "backend/saved/scaler.pkl")
joblib.dump({"mean": y_mean, "std": y_std}, "backend/saved/target_scaler.pkl")

model.eval()

with torch.no_grad():
    train_preds = model(X_train_tensor).detach().numpy().flatten()
    val_preds = model(X_val_tensor).detach().numpy().flatten()
    test_preds = model(X_test_tensor).detach().numpy().flatten()

    train_preds = train_preds * y_std + y_mean
    val_preds = val_preds * y_std + y_mean
    test_preds = test_preds * y_std + y_mean

    y_train_np = (y_train_tensor.detach().numpy().flatten() * y_std) + y_mean
    y_val_np = (y_val_tensor.detach().numpy().flatten() * y_std) + y_mean
    y_test_np = (y_test_tensor.detach().numpy().flatten() * y_std) + y_mean

    train_embeddings = model.feature_extractor(X_train_tensor).cpu().numpy()
    print(train_embeddings.shape)
    np.save("backend/saved/train_embeddings.npy", train_embeddings)
    np.save("backend/saved/train_indices.npy", idx_train)


plt.figure()

plt.scatter(y_train_np, train_preds, label="Train", alpha=0.4)
plt.scatter(y_val_np, val_preds, label="Val", alpha=0.4)
plt.scatter(y_test_np, test_preds, label="Test", alpha=0.4)

min_val = min(y_train_np.min(), y_val_np.min(), y_test_np.min())
max_val = max(y_train_np.max(), y_val_np.max(), y_test_np.max())

plt.plot([min_val, max_val], [min_val, max_val])

plt.xlabel("True Price")
plt.ylabel("Predicted Price")
plt.title("True vs Predicted Prices")
plt.legend()
plt.show()