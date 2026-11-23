"""员工学习接口请求模型。"""

from pydantic import BaseModel, ConfigDict


class ChapterCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")