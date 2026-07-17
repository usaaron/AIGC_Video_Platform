from app.modules.asset.models import Asset


class AssetRepository:
    """In-memory repository used until the Knowledge Base schema is finalized."""

    def __init__(self) -> None:
        self._items: dict[str, Asset] = {}

    def save(self, asset: Asset) -> Asset:
        self._items[asset.id] = asset
        return asset

    def get(self, asset_id: str) -> Asset | None:
        return self._items.get(asset_id)

    def list(self) -> list[Asset]:
        return list(self._items.values())
