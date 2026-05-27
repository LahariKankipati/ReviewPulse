"""Groq (default) and Gemini provider implementations."""
from __future__ import annotations

import json
from dataclasses import dataclass

import httpx
from groq import Groq
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from app.config import get_settings
from app.llm.schemas import AnalysisUsage, AnalyzeReviewResponse, EmbedResponse, ReviewAnalysisResult

settings = get_settings()


ANALYSIS_PROMPT = (
    "Analyze this book review and return strict JSON only with these exact keys: "
    "sentiment (MUST be exactly one of: positive, mixed, negative — never neutral or other values), "
    "sentiment_confidence (float 0-1), themes (list of strings), "
    "ai_generated_flag (bool), ai_confidence (float 0-1), "
    "summary (string), actionable (bool), actionability_reason (string)."
)

_SENTIMENT_MAP = {
    "neutral": "mixed",
    "positive": "positive",
    "mixed": "mixed",
    "negative": "negative",
}


def _extract_json(text: str) -> dict:
    """Extract and parse the first JSON object from a model response string, normalizing sentiment."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response did not contain JSON object")
    data = json.loads(text[start : end + 1])
    # Normalize sentiment to the allowed set
    if "sentiment" in data:
        data["sentiment"] = _SENTIMENT_MAP.get(str(data["sentiment"]).lower(), "mixed")
    return data


@dataclass
class GroqProvider:
    provider_name: str = "groq"
    model: str = settings.llm_model_groq

    @retry(
        retry=retry_if_exception_type(Exception),
        wait=wait_exponential_jitter(initial=1, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        """Call the Groq chat API to classify sentiment, themes, AI-detection, and actionability for a review."""
        if not settings.groq_api_key:
            raise ValueError("GROQ_API_KEY is not configured")

        client = Groq(api_key=settings.groq_api_key)
        prompt = f"{ANALYSIS_PROMPT}\nTitle: {review_title}\nBody: {review_body}"
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=700,
            temperature=0,
        )

        text = response.choices[0].message.content or ""
        parsed = _extract_json(text)

        usage = response.usage
        tokens_in = getattr(usage, "prompt_tokens", 0) or 0
        tokens_out = getattr(usage, "completion_tokens", 0) or 0

        return AnalyzeReviewResponse(
            provider=self.provider_name,
            model=self.model,
            result=ReviewAnalysisResult.model_validate(parsed),
            usage=AnalysisUsage(tokens_in=tokens_in, tokens_out=tokens_out, cost_usd=0.0),
        )

    def embed_text(self, *, text: str) -> EmbedResponse:
        """Delegate embedding to JinaProvider since Groq offers no embedding model."""
        # Groq has no embedding model — delegate to Jina
        return JinaProvider().embed_text(text=text)


@dataclass
class JinaProvider:
    provider_name: str = "jina"

    @retry(
        retry=retry_if_exception_type(Exception),
        wait=wait_exponential_jitter(initial=1, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    def embed_text(self, *, text: str) -> EmbedResponse:
        """Call the Jina AI embeddings API and return a 768-dim vector for the input text."""
        if not settings.jina_api_key:
            raise ValueError("JINA_API_KEY is not configured")

        resp = httpx.post(
            "https://api.jina.ai/v1/embeddings",
            headers={"Authorization": f"Bearer {settings.jina_api_key}", "Content-Type": "application/json"},
            json={"model": "jina-embeddings-v2-base-en", "input": [text]},
            timeout=30,
        )
        resp.raise_for_status()
        vector = resp.json()["data"][0]["embedding"]

        return EmbedResponse(provider=self.provider_name, model="jina-embeddings-v2-base-en", vector=vector)

    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        """Raise NotImplementedError as JinaProvider is for embeddings only, not text analysis."""
        raise NotImplementedError("Use GroqProvider for analysis")


@dataclass
class GeminiProvider:
    """Second LLM adapter implementation (N2).
    Gemini quota was exhausted during development — Groq is the active provider.
    This stub satisfies the provider-agnostic adapter contract; swap in a working
    Gemini API key and un-stub analyze_review to activate.
    """
    provider_name: str = "gemini"
    model: str = "gemini-2.0-flash"

    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        """Raise NotImplementedError as the Gemini provider is currently inactive."""
        raise NotImplementedError(
            "GeminiProvider.analyze_review is not active — Gemini quota was exhausted. "
            "Use GroqProvider (default) or restore a valid GEMINI_API_KEY to enable."
        )

    def embed_text(self, *, text: str) -> EmbedResponse:
        """Raise NotImplementedError as Gemini embeddings are inactive; JinaProvider is used instead."""
        raise NotImplementedError(
            "GeminiProvider.embed_text is not active — using JinaProvider for embeddings. "
            "Restore a valid GEMINI_API_KEY to enable."
        )
