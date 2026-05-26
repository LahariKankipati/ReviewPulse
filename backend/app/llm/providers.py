"""Gemini and Anthropic provider implementations."""
from __future__ import annotations

import json
from dataclasses import dataclass

import anthropic
import google.generativeai as genai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from app.config import get_settings
from app.llm.schemas import AnalysisUsage, AnalyzeReviewResponse, EmbedResponse, ReviewAnalysisResult

settings = get_settings()


ANALYSIS_PROMPT = (
    "Analyze this book review and return strict JSON only with keys: "
    "sentiment, sentiment_confidence, themes, ai_generated_flag, ai_confidence, "
    "summary, actionable, actionability_reason."
)


def _extract_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model response did not contain JSON object")
    return json.loads(text[start : end + 1])


def _estimate_cost_usd(*, provider: str, model: str, tokens_in: int, tokens_out: int) -> float:
    pricing = {
        "gemini": {"in": 0.00000015, "out": 0.00000030},
        "anthropic": {"in": 0.00000080, "out": 0.00000400},
    }
    rate = pricing.get(provider, {"in": 0.0, "out": 0.0})
    return round((tokens_in * rate["in"]) + (tokens_out * rate["out"]), 8)


@dataclass
class GeminiProvider:
    provider_name: str = "gemini"
    model: str = settings.llm_model_gemini

    def __post_init__(self) -> None:
        if settings.gemini_api_key:
            genai.configure(api_key=settings.gemini_api_key)

    @retry(
        retry=retry_if_exception_type(Exception),
        wait=wait_exponential_jitter(initial=1, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is not configured")

        model = genai.GenerativeModel(self.model)
        prompt = f"{ANALYSIS_PROMPT}\nTitle: {review_title}\nBody: {review_body}"
        response = model.generate_content(prompt)

        text = getattr(response, "text", "") or ""
        parsed = _extract_json(text)
        usage_meta = getattr(response, "usage_metadata", None)
        tokens_in = int(getattr(usage_meta, "prompt_token_count", 0) or 0)
        tokens_out = int(getattr(usage_meta, "candidates_token_count", 0) or 0)

        usage = AnalysisUsage(
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=_estimate_cost_usd(
                provider=self.provider_name,
                model=self.model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            ),
        )

        return AnalyzeReviewResponse(
            provider=self.provider_name,
            model=self.model,
            result=ReviewAnalysisResult.model_validate(parsed),
            usage=usage,
        )

    @retry(
        retry=retry_if_exception_type(Exception),
        wait=wait_exponential_jitter(initial=1, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    def embed_text(self, *, text: str) -> EmbedResponse:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is not configured")

        emb = genai.embed_content(model="models/text-embedding-004", content=text)
        vector = emb["embedding"] if isinstance(emb, dict) else emb.embedding

        return EmbedResponse(provider=self.provider_name, model="text-embedding-004", vector=vector)


@dataclass
class AnthropicProvider:
    provider_name: str = "anthropic"
    model: str = settings.llm_model_anthropic

    @retry(
        retry=retry_if_exception_type(Exception),
        wait=wait_exponential_jitter(initial=1, max=8),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is not configured")

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        prompt = f"{ANALYSIS_PROMPT}\nTitle: {review_title}\nBody: {review_body}"
        msg = client.messages.create(
            model=self.model,
            max_tokens=700,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )

        chunks = getattr(msg, "content", [])
        text = "".join(getattr(c, "text", "") for c in chunks)
        parsed = _extract_json(text)

        usage_meta = getattr(msg, "usage", None)
        tokens_in = int(getattr(usage_meta, "input_tokens", 0) or 0)
        tokens_out = int(getattr(usage_meta, "output_tokens", 0) or 0)

        usage = AnalysisUsage(
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=_estimate_cost_usd(
                provider=self.provider_name,
                model=self.model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            ),
        )

        return AnalyzeReviewResponse(
            provider=self.provider_name,
            model=self.model,
            result=ReviewAnalysisResult.model_validate(parsed),
            usage=usage,
        )

    def embed_text(self, *, text: str) -> EmbedResponse:
        raise NotImplementedError("Anthropic embedding is not configured for this project")
