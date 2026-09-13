from fastapi import APIRouter, Depends, Query, Response, status

from app.dependencies import get_hongguo_trends_service
from app.modules.hongguo_trends.models import (
    HongguoCategoriesData,
    HongguoCategoriesResponse,
    HongguoFormat,
    HongguoTrendsData,
    HongguoTrendsResponse,
)
from app.modules.hongguo_trends.service import HongguoTrendsService

router = APIRouter(prefix="/hongguo", tags=["HongguoTrends"])


@router.get("/trending-tags", response_model=HongguoTrendsResponse,
            responses={503: {"model": HongguoTrendsResponse}})
def get_trending_tags(
    response: Response,
    format: HongguoFormat = Query("comic"),
    service: HongguoTrendsService = Depends(get_hongguo_trends_service),
) -> HongguoTrendsResponse:
    snapshot = service.get(format)
    if snapshot.status == "unavailable":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        response.headers["Retry-After"] = "300"
    response.headers["Cache-Control"] = "no-store"
    return HongguoTrendsResponse(data=HongguoTrendsData.model_validate(
        snapshot.model_dump(exclude={"categories", "taxonomy_revision"}),
    ))


@router.get("/categories", response_model=HongguoCategoriesResponse,
            responses={503: {"model": HongguoCategoriesResponse}})
def get_categories(
    response: Response,
    format: HongguoFormat = Query("comic"),
    service: HongguoTrendsService = Depends(get_hongguo_trends_service),
) -> HongguoCategoriesResponse:
    snapshot = service.get_categories(format)
    if snapshot.status == "unavailable":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        response.headers["Retry-After"] = "300"
    response.headers["Cache-Control"] = "no-store"
    return HongguoCategoriesResponse(data=HongguoCategoriesData.model_validate(
        snapshot.model_dump(exclude={"recommendations", "sample_work_count", "pages_fetched", "taxonomy_revision"}),
    ))
