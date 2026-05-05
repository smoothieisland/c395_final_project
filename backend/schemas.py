from pydantic import BaseModel
from typing import Optional


class FeatureInput(BaseModel):
    bedrooms: int
    bathrooms: int

    cats_ok: Optional[int] = None
    dogs_ok: Optional[int] = None

    cafes_nearby: Optional[int] = None
    minutes_to_closest_cafe: Optional[int] = None

    restaurants_nearby: Optional[int] = None
    minutes_to_closest_restaurant: Optional[int] = None

    shops_nearby: Optional[int] = None
    minutes_to_nearest_bus_stop: Optional[int] = None
    minutes_to_nearest_t_station: Optional[int] = None

    parks_nearby: Optional[int] = None
    minutes_to_closest_drugstore: Optional[int] = None
    minutes_to_closest_urgent_care: Optional[int] = None


class Filters(BaseModel):
    min_bedrooms: Optional[int]
    max_bedrooms: Optional[int]

    min_bathrooms: Optional[int]
    max_bathrooms: Optional[int]

    require_cats_ok: Optional[int]
    require_dogs_ok: Optional[int]


class Location(BaseModel):
    latitude: float
    longitude: float


class RecommendRequest(BaseModel):
    filters: Filters
    location: Optional[Location]
    features: FeatureInput


class PredictRequest(BaseModel):
    bedrooms: int
    bathrooms: int

    cats_ok: Optional[int] = None
    dogs_ok: Optional[int] = None

    cafes_nearby: Optional[int] = None
    minutes_to_closest_cafe: Optional[int] = None

    restaurants_nearby: Optional[int] = None
    minutes_to_closest_restaurant: Optional[int] = None

    shops_nearby: Optional[int] = None
    minutes_to_nearest_bus_stop: Optional[int] = None
    minutes_to_nearest_t_station: Optional[int] = None

    parks_nearby: Optional[int] = None
    minutes_to_closest_drugstore: Optional[int] = None
    minutes_to_closest_urgent_care: Optional[int] = None