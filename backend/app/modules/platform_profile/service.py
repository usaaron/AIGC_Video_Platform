from app.modules.platform_profile.models import PlatformProfile, PlatformProfileCreate
from app.modules.platform_profile.repository import PlatformProfileRepository


class DuplicatePlatformProfileError(ValueError):
    """Raised when a platform profile id already exists."""


class PlatformProfileService:
    def __init__(self, repository: PlatformProfileRepository) -> None:
        self._repository = repository

    def create(self, payload: PlatformProfileCreate) -> PlatformProfile:
        if self._repository.get(payload.id) is not None:
            raise DuplicatePlatformProfileError(
                f"PlatformProfile '{payload.id}' already exists."
            )

        platform_profile = PlatformProfile.model_validate(payload.model_dump())
        return self._repository.save(platform_profile)

    def get(self, platform_profile_id: str) -> PlatformProfile | None:
        return self._repository.get(platform_profile_id)

    def list(self) -> list[PlatformProfile]:
        return self._repository.list()
