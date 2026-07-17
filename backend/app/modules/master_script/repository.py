from app.modules.master_script.models import MasterScript


class MasterScriptRepository:
    """In-memory repository used until persistence is introduced."""

    def __init__(self) -> None:
        self._items: dict[str, MasterScript] = {}

    def save(self, master_script: MasterScript) -> MasterScript:
        self._items[master_script.id] = master_script
        return master_script

    def get(self, master_script_id: str) -> MasterScript | None:
        return self._items.get(master_script_id)

    def list(self) -> list[MasterScript]:
        return list(self._items.values())
