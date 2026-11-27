from pydantic import Field
from .common import MongoModel


class QuizQuestion(MongoModel):
    question: str
    options: list[str]
    correct_index: int = Field(alias="correctIndex")


class Quiz(MongoModel):
    user_id: object = Field(alias="userId")
    document_id: object | None = Field(default=None, alias="documentId")
    title: str
    questions: list[QuizQuestion]
