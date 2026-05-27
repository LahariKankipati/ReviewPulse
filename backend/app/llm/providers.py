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
        # Groq has no embedding model — delegate to Gemini (separate quota from generate_content)
        return GeminiProvider().embed_text(text=text)


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
        raise NotImplementedError("Use GroqProvider for analysis")
