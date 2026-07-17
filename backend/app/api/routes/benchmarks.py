from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_benchmark_service, get_prompt_evaluation_service
from evaluation.benchmark_runner import MissingBenchmarkDatasetError
from evaluation.models import (
    BenchmarkErrorResponse,
    BenchmarkRunListResponse,
    BenchmarkRunRequest,
    BenchmarkRunResponse,
    PromptEvaluationRunListResponse,
    PromptEvaluationRunRequest,
    PromptEvaluationRunResponse,
)

router = APIRouter(prefix="/benchmarks", tags=["Benchmark"])


@router.post(
    "/run",
    response_model=BenchmarkRunResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": BenchmarkErrorResponse},
        422: {"model": BenchmarkErrorResponse},
    },
)
def run_benchmark(
    payload: BenchmarkRunRequest,
    service=Depends(get_benchmark_service),
) -> BenchmarkRunResponse:
    try:
        result = service.run(payload)
    except MissingBenchmarkDatasetError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BenchmarkRunResponse(data=result)


@router.get("", response_model=BenchmarkRunListResponse)
def list_benchmark_results(
    service=Depends(get_benchmark_service),
) -> BenchmarkRunListResponse:
    return BenchmarkRunListResponse(data=service.list_results())


@router.get(
    "/results/{result_id}",
    response_model=BenchmarkRunResponse,
    responses={404: {"model": BenchmarkErrorResponse}},
)
def get_benchmark_result(
    result_id: str,
    service=Depends(get_benchmark_service),
) -> BenchmarkRunResponse:
    result = service.get_result(result_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Benchmark run result '{result_id}' was not found.",
        )
    return BenchmarkRunResponse(data=result)


@router.post(
    "/prompt-evaluations/run",
    response_model=PromptEvaluationRunResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": BenchmarkErrorResponse},
        422: {"model": BenchmarkErrorResponse},
    },
)
def run_prompt_evaluation(
    payload: PromptEvaluationRunRequest,
    service=Depends(get_prompt_evaluation_service),
) -> PromptEvaluationRunResponse:
    try:
        result = service.run(payload)
    except MissingBenchmarkDatasetError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return PromptEvaluationRunResponse(data=result)


@router.get(
    "/prompt-evaluations",
    response_model=PromptEvaluationRunListResponse,
)
def list_prompt_evaluation_results(
    service=Depends(get_prompt_evaluation_service),
) -> PromptEvaluationRunListResponse:
    return PromptEvaluationRunListResponse(data=service.list_results())


@router.get(
    "/prompt-evaluations/results/{result_id}",
    response_model=PromptEvaluationRunResponse,
    responses={404: {"model": BenchmarkErrorResponse}},
)
def get_prompt_evaluation_result(
    result_id: str,
    service=Depends(get_prompt_evaluation_service),
) -> PromptEvaluationRunResponse:
    result = service.get_result(result_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prompt evaluation result '{result_id}' was not found.",
        )
    return PromptEvaluationRunResponse(data=result)
