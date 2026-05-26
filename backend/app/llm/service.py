"""Provider-agnostic LLM service used by pipeline code."""
from __future__ import annotations

from app.config import get_settings
from app.llm.base import LLMProvider
from app.llm.providers import AnthropicProvider, GeminiProvider
from app.llm.schemas import AnalyzeReviewResponse, EmbedResponse
from app.logging_config import get_logger

logger = get_logger("reviewpulse.llm")
settings = get_settings()


def get_provider(name: str | None = None) -> LLMProvider:
    selected = (name or settings.llm_provider).lower().strip()
    if selected == "gemini":
        return GeminiProvider()
    if selected == "anthropic":
        return AnthropicProvider()
    raise ValueError(f"Unsupported provider: {selected}")


def analyze_review(*, review_title: str, review_body: str, provider_name: str | None = None) -> AnalyzeReviewResponse:
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
    provider = get_provider(provider_name)
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
