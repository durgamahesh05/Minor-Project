from pydantic import Field
from .common import MongoModel


class Flashcard(MongoModel):
    front: str
    back: str


class FlashcardSet(MongoModel):
    user_id: object = Field(alias="userId")
    document_id: object | None = Field(default=None, alias="documentId")
    title: str
    cards: list[Flashcard]
