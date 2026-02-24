from pydantic import BaseModel, Field
from typing import Literal


class TextToModelRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=500)
    action_policy: Literal["strict", "balanced"] = "strict"


class PipelineResponse(BaseModel):
    status: str
    source: str
    action_policy: Literal["strict", "balanced"]
    output_model_url: str
    viewer_url: str
    animations: list[str]
    action_report: list[dict[str, str]]
