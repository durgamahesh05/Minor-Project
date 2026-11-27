from datetime import datetime
from pydantic import Field
from .common import MongoModel


class PendingRegistration(MongoModel):
    name: str
    email: str
    password_hash: str = Field(alias="passwordHash")
    otp_hash: str = Field(alias="otpHash")
    otp_expires_at: datetime = Field(alias="otpExpiresAt")
