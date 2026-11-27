from datetime import datetime
from typing import Literal
from pydantic import Field
from .common import MongoModel


class User(MongoModel):
    name: str
    email: str
    password_hash: str = Field(alias="passwordHash")
    role: Literal["user", "admin"] = "user"
    reset_token_hash: str | None = Field(default=None, alias="resetTokenHash")
    reset_token_expires_at: datetime | None = Field(default=None, alias="resetTokenExpiresAt")
    delete_otp_hash: str | None = Field(default=None, alias="deleteOtpHash")
    delete_otp_expires_at: datetime | None = Field(default=None, alias="deleteOtpExpiresAt")
