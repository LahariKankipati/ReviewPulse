"""Provider-agnostic LLM service used by pipeline code."""
from __future__ import annotations

from app.config import get_settings
from app.llm.base import LLMProvider
from app.llm.providers import GeminiProvider, GroqProvider, JinaProvider
from app.llm.schemas import AnalyzeReviewResponse, EmbedResponse
from app.logging_config import get_logger

logger = get_logger("reviewpulse.llm")
settings = get_settings()


def get_provider(name: str | None = None) -> LLMProvider:
    """Resolve and return an LLM provider instance by name, defaulting to the configured provider."""
    selected = (name or settings.llm_provider).lower().strip()
    if selected == "groq":
        return GroqProvider()
    if selected == "gemini":
        return GeminiProvider()
    raise ValueError(f"Unsupported provider: {selected}")


def analyze_review(*, review_title: str, review_body: str, provider_name: str | None = None) -> AnalyzeReviewResponse:
    """Route a review through the configured LLM provider for sentiment, theme, and AI-flag analysis."""
    provider = get_provider(provider_name)
    response = provider.analyze_review(review_title=review_title, review_body=review_body)
    logger.info(
        "analysis_completed",
        extra={
            "provider": response.provider,
            "model": response.model,
            "tokens_in": response.usage.tokens_in,
            "tokens_out": response.usage.tokens_out,
            "cost_usd": response.usage.cost_usd,
        },
    )
    return response


def embed_text(*, text: str, provider_name: str | None = None) -> EmbedResponse:
    """Generate a vector embedding for the given text using JinaProvider."""
    provider = JinaProvider()
    response = provider.embed_text(text=text)
    logger.info(
        "embedding_completed",
        extra={
            "provider": response.provider,
            "model": response.model,
            "vector_dim": len(response.vector),
        },
    )
    return response
