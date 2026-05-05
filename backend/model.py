import torch
import torch.nn as nn

class PriceModel(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.feature_extractor = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 8)
        )
        self.regressor = nn.Linear(8, 1)

    def forward(self, x):
        emb = self.feature_extractor(x)
        return self.regressor(emb)