import pytest

from app.seed_data import RUBRIC_RULES
from app.services.roleplay_scoring import (
    ModelScoringOutput,
    ScoringInvalidOutputError,
    ScoringUnavailableError,
    build_scoring_graph,
    score_answer,
)

SAMPLES = {
    "correct": {
        "text": "您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！",
        "total": 99,
        "passed": True,
        "dims": [99, 98, 99, 98],
        "missed": [],
        "redlines": [],
    },
    "synonym": {
        "text": "这款是日本正版授权的联名毛绒公仔，手感软糯，五十九块钱一个；端盒六个不重样，您要不要摸一下拆开的样品？加 9.9 元还能配防尘挂袋。",
        "total": 91,
        "passed": True,
        "dims": [99, 82, 99, 78],
        "missed": [],
        "redlines": [],
    },
    "missing": {
        "text": "这款是正版联名授权毛绒公仔，手感软糯还有隐藏款，59 元一个。您放心，可以摇盒挑手感，品质细腻，再摸摸拆好的样品，加 9.9 元配防尘挂袋哦。",
        "total": 99,
        "passed": False,
        "dims": [99, 98, 99, 99],
        "missed": ["fact_box_rule"],
        "redlines": [],
    },
    "factual_error": {
        "text": "这款是正版联名毛绒公仔，59 元，端盒 6 个可能会重复，您摸摸样品，加 9.9 元配防尘挂袋，买一送一哦。",
        "total": 69,
        "passed": False,
        "dims": [60, 51, 99, 88],
        "missed": ["fact_box_rule"],
        "redlines": ["买一送一"],
    },
}


@pytest.mark.parametrize("name", list(SAMPLES))
async def test_contract_scoring_samples(name):
    sample = SAMPLES[name]
    result = await score_answer(RUBRIC_RULES, "default", sample["text"])

    assert result.total == sample["total"]
    assert result.passed is sample["passed"]
    assert [dim.score for dim in result.dims] == sample["dims"]
    assert [fact.key for fact in result.missed_required_facts] == sample["missed"]
    assert [hit.term for hit in result.redline_hits] == sample["redlines"]
    assert result.weakest.score == min(sample["dims"])
    assert result.demo_pitch == RUBRIC_RULES["demo_pitch"]


async def test_price_negation_guard():
    text = "这款不是 59 元，是 49 元，正版授权，有样品可以摸。"
    result = await score_answer(RUBRIC_RULES, "default", text)

    price = next(fact for fact in result.fact_checks if fact.key == "fact_price")
    assert price.status == "missed"
    assert price.evidence is None


async def test_invalid_model_candidate_is_rejected():
    class BadScorer:
        async def propose(self, *, rubric, question_variant, answer_text):
            _ = rubric, question_variant, answer_text
            return ModelScoringOutput(
                hits={"selling": ["不存在的关键词"]},
                fact_checks=[],
                redline_hits=[],
            )

    graph = build_scoring_graph(BadScorer())
    with pytest.raises(ScoringInvalidOutputError):
        await score_answer(
            RUBRIC_RULES,
            "default",
            "这款是正版联名毛绒公仔。",
            graph=graph,
        )


async def test_unavailable_scorer_propagates():
    class DownScorer:
        async def propose(self, *, rubric, question_variant, answer_text):
            _ = rubric, question_variant, answer_text
            raise ScoringUnavailableError("provider down")

    graph = build_scoring_graph(DownScorer())
    with pytest.raises(ScoringUnavailableError):
        await score_answer(
            RUBRIC_RULES,
            "default",
            "这款是正版联名毛绒公仔。",
            graph=graph,
        )