from app.llm.schemas import AnalysisUsage, AnalyzeReviewResponse, EmbedResponse, ReviewAnalysisResult
from app.llm.service import get_provider


class _MockProvider:
    provider_name = "mock"

    def analyze_review(self, *, review_title: str, review_body: str) -> AnalyzeReviewResponse:
        return AnalyzeReviewResponse(
            provider="mock",
            model="mock-1",
            result=ReviewAnalysisResult(
                sentiment="positive",
                sentiment_confidence=0.93,
                themes=["pacing", "characters"],
                ai_generated_flag=False,
                ai_confidence=0.08,
                summary="Strong pacing and relatable characters.",
                actionable=True,
                actionability_reason="Pacing and character notes can inform sequel planning.",
            ),
            usage=AnalysisUsage(tokens_in=120, tokens_out=80, cost_usd=0.0002),
        )

    def embed_text(self, *, text: str) -> EmbedResponse:
        return EmbedResponse(provider="mock", model="mock-embed", vector=[0.1, 0.2, 0.3])


def test_schema_validation_accepts_valid_structured_response():
    result = ReviewAnalysisResult(
        sentiment="mixed",
        sentiment_confidence=0.61,
        themes=["ending"],
        ai_generated_flag=True,
        ai_confidence=0.72,
        summary="Interesting premise but uneven execution.",
        actionable=False,
        actionability_reason="",
    )
    assert result.sentiment == "mixed"


def test_get_provider_rejects_unknown_provider():
    try:
        get_provider("unknown")
        assert False, "Expected ValueError for unsupported provider"
    except ValueError as exc:
        assert "Unsupported provider" in str(exc)


def test_mock_provider_returns_usage_and_cost_fields():
    provider = _MockProvider()
    analysis = provider.analyze_review(review_title="t", review_body="b")
    embedding = provider.embed_text(text="hello")

    assert analysis.usage.tokens_in > 0
    assert analysis.usage.tokens_out > 0
    assert analysis.usage.cost_usd > 0
    assert len(embedding.vector) == 3
