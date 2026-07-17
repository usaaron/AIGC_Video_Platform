from app.modules.asset.models import Asset, AssetCreate
from app.modules.asset.repository import AssetRepository
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.platform_profile.repository import PlatformProfileRepository


class DuplicateAssetError(ValueError):
    """Raised when an asset id already exists."""


class MissingOntologyNodeError(ValueError):
    """Raised when a referenced ontology node does not exist."""


class InvalidTagReferenceError(ValueError):
    """Raised when a tag reference does not match its ontology node."""


class MissingPlatformProfileError(ValueError):
    """Raised when an applicable platform profile does not exist."""


class AssetService:
    def __init__(
        self,
        repository: AssetRepository,
        ontology_node_repository: OntologyNodeRepository,
        platform_profile_repository: PlatformProfileRepository,
    ) -> None:
        self._repository = repository
        self._ontology_node_repository = ontology_node_repository
        self._platform_profile_repository = platform_profile_repository

    def create(self, payload: AssetCreate) -> Asset:
        if self._repository.get(payload.id) is not None:
            raise DuplicateAssetError(f"Asset '{payload.id}' already exists.")

        for tag in payload.tags:
            ontology_node = self._ontology_node_repository.get(tag.ontology_node_id)
            if ontology_node is None:
                raise MissingOntologyNodeError(
                    f"OntologyNode '{tag.ontology_node_id}' was not found."
                )

            if tag.label != ontology_node.label or tag.category != ontology_node.category.value:
                raise InvalidTagReferenceError(
                    "Tag reference does not match its ontology node definition for "
                    f"'{tag.ontology_node_id}'."
                )

        for platform_profile_id in payload.applicable_platform_profile_ids:
            if self._platform_profile_repository.get(platform_profile_id) is None:
                raise MissingPlatformProfileError(
                    f"PlatformProfile '{platform_profile_id}' was not found."
                )

        asset = Asset.model_validate(payload.model_dump())
        return self._repository.save(asset)

    def get(self, asset_id: str) -> Asset | None:
        return self._repository.get(asset_id)

    def list(self) -> list[Asset]:
        return self._repository.list()
