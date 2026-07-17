from app.modules.trend_snapshot.models import TrendSnapshot


class TrendSnapshotRepository:
    """In-memory repository for generated trend snapshots."""

    def __init__(self) -> None:
        self._items: dict[str, TrendSnapshot] = {}

    def save(self, snapshot: TrendSnapshot) -> TrendSnapshot:
        self._items[snapshot.id] = snapshot
        return snapshot

    def get(self, snapshot_id: str) -> TrendSnapshot | None:
        return self._items.get(snapshot_id)

    def list(self) -> list[TrendSnapshot]:
        return list(self._items.values())
