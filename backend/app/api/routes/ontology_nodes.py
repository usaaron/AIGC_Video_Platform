from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_ontology_node_service
from app.modules.ontology_node.models import (
    ErrorResponse,
    OntologyNodeCreate,
    OntologyNodeListResponse,
    OntologyNodeResponse,
)
from app.modules.ontology_node.service import (
    DuplicateOntologyNodeError,
    OntologyNodeService,
)

router = APIRouter(prefix="/ontology-nodes", tags=["OntologyNode"])


@router.post(
    "",
    response_model=OntologyNodeResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_ontology_node(
    payload: OntologyNodeCreate,
    service: OntologyNodeService = Depends(get_ontology_node_service),
) -> OntologyNodeResponse:
    try:
        ontology_node = service.create(payload)
    except DuplicateOntologyNodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return OntologyNodeResponse(data=ontology_node)


@router.get(
    "",
    response_model=OntologyNodeListResponse,
)
def list_ontology_nodes(
    service: OntologyNodeService = Depends(get_ontology_node_service),
) -> OntologyNodeListResponse:
    return OntologyNodeListResponse(data=service.list())


@router.get(
    "/{ontology_node_id}",
    response_model=OntologyNodeResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_ontology_node(
    ontology_node_id: str,
    service: OntologyNodeService = Depends(get_ontology_node_service),
) -> OntologyNodeResponse:
    ontology_node = service.get(ontology_node_id)
    if ontology_node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OntologyNode '{ontology_node_id}' was not found.",
        )

    return OntologyNodeResponse(data=ontology_node)
