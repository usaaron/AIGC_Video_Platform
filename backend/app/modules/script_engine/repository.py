from app.document_repository import DocumentRepository
from app.modules.script_engine.models import GenerationStrategy, PromptLibraryItem


class PromptLibraryRepository(DocumentRepository[PromptLibraryItem]):
    model_type = PromptLibraryItem
    namespace = "prompt_library"


class GenerationStrategyRepository(DocumentRepository[GenerationStrategy]):
    model_type = GenerationStrategy
    namespace = "generation_strategies"
