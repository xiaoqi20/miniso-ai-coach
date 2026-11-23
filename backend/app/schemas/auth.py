from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

UserRoleLiteral = Literal["staff", "store_manager", "hq_ops"]
StoreRoleLiteral = Literal["staff", "store_manager"]


class DevLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    user_id: str = Field(min_length=1, max_length=40)


class StoreRef(BaseModel):
    id: str
    name: str
    role: StoreRoleLiteral


class UserRef(BaseModel):
    id: str
    name: str
    role: UserRoleLiteral
    stores: list[StoreRef]


class SessionRef(BaseModel):
    expires_at: str


class LoginResponse(BaseModel):
    user: UserRef
    session: SessionRef


class MeResponse(BaseModel):
    user: UserRef
    capabilities: list[str]
    server_time: str