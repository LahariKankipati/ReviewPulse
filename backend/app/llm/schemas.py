"""LLM input/output schemas for structured analysis."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ReviewAnalysisResult(BaseModel):
    sentiment: str = Field(pattern="^(positive|mixed|negative)$")
    sentiment_confidence: float = Field(ge=0.0, le=1.0)
    themes: list[str] = Field(default_factory=list)
    ai_generated_flag: bool
    ai_confidence: float = Field(ge=0.0, le=1.0)
    summary: str
    actionable: bool
    actionability_reason: str = ""


class AnalysisUsage(BaseModel):
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0


class AnalyzeReviewResponse(BaseModel):
    provider: str
    model: str
    result: ReviewAnalysisResult
    usage: AnalysisUsage


class EmbedResponse(BaseModel):
    provider: str
    model: str
    vector: list[float]
