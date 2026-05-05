from fastapi import FastAPI
from typing import Union

from schemas import RecommendRequest, PredictRequest
from service import handle_request

app = FastAPI()

@app.post("/api")
def api(payload: Union[RecommendRequest, PredictRequest]):
    return handle_request(payload.dict())