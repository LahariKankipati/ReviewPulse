"""Provider protocol for pluggable LLM implementations."""
from __future__ import annotations

from typing import Protocol

from app.llm.schemas import AnalyzeReviewResponse, EmbedResponse


class LLMProvider(Protocol):
    provider_name: str

    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        """Return structured review analysis with usage/cost metadata."""

    def embed_text(self, *, text: str) -> EmbedResponse:
        """Return embedding vector for semantic search."""
