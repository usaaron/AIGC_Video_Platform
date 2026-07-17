from app.modules.platform_profile.models import PlatformProfile


class PlatformProfileRepository:
    """In-memory repository used until the database schema is finalized."""

    def __init__(self) -> None:
        self._items: dict[str, PlatformProfile] = {}

    def save(self, platform_profile: PlatformProfile) -> PlatformProfile:
        self._items[platform_profile.id] = platform_profile
        return platform_profile

    def get(self, platform_profile_id: str) -> PlatformProfile | None:
        return self._items.get(platform_profile_id)

    def list(self) -> list[PlatformProfile]:
        return list(self._items.values())
