from app.modules.scheduled_ingestion.models import DataIngestionJob


class DataIngestionJobRepository:
    """In-memory repository used until scheduled ingestion persistence is introduced."""

    def __init__(self) -> None:
        self._items: dict[str, DataIngestionJob] = {}

    def save(self, job: DataIngestionJob) -> DataIngestionJob:
        self._items[job.id] = job
        return job

    def get(self, job_id: str) -> DataIngestionJob | None:
        return self._items.get(job_id)

    def list(self) -> list[DataIngestionJob]:
        return list(self._items.values())
