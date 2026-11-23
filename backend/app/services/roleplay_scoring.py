"""对练评分的 LangGraph 工作流。

模型（M1 使用确定性替身）只提出关键词命中、事实与红线候选；业务层按
绑定规则重新核验候选，并重新计算四维分和总分。图本身不访问数据库，
调用方负责在事务外执行它。
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Literal, Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, ValidationError

from app.schemas.course import M1_DIMENSION_KEYS

DIMENSION_ORDER = M1_DIMENSION_KEYS
NEGATION_TERMS = ("不是", "并非", "不只", "不止", "别报", "错报成", "不是卖")
PRICE_SUFFIX = r"(?:\s*(?:元|块|块钱|元左右))?"


class ScoringUnavailableError(Exception):
    """模型调用失败或超时，轮次可保留后重试。"""


class ScoringInvalidOutputError(Exception):
    """模型候选无法通过规则核验。"""


class ModelFactCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    status: Literal["hit", "missed"]
    evidence: str | None = None


class ModelRedlineHit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: str
    evidence: str


class ModelScoringOutput(BaseModel):
    """模型替身的结构化候选；不包含最终分数。"""

    model_config = ConfigDict(extra="forbid")

    hits: dict[str, list[str]]
    fact_checks: list[ModelFactCheck]
    redline_hits: list[ModelRedlineHit]


class DimensionScore(BaseModel):
    key: str
    name: str
    score: int


class FactRef(BaseModel):
    key: str
    label: str


class FactCheckResult(BaseModel):
    key: str
    label: str
    required: bool
    status: Literal["hit", "missed"]
    evidence: str | None


class RedlineResult(BaseModel):
    term: str
    reason: str
    evidence: str


class ScoringResult(BaseModel):
    threshold: int
    total: int
    passed: bool
    dims: list[DimensionScore]
    fact_checks: list[FactCheckResult]
    missed_required_facts: list[FactRef]
    missed_facts: list[FactRef]
    redline_hits: list[RedlineResult]
    weakest: DimensionScore
    advice: str
    demo_pitch: str


class ScoringState(TypedDict, total=False):
    rubric: dict[str, Any]
    question_variant: str
    answer_text: str
    model_output: dict[str, Any]
    result: dict[str, Any]


class Scorer(Protocol):
    async def propose(
        self,
        *,
        rubric: dict[str, Any],
        question_variant: str,
        answer_text: str,
    ) -> ModelScoringOutput: ...


def normalize_text(value: str) -> str:
    """NFKC、裁剪首尾并折叠连续空白；长度按 Unicode 码点计算。"""
    normalized = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", " ", normalized.strip())


def _casefold(value: str) -> str:
    return normalize_text(value).casefold()


def _clauses(text: str) -> list[str]:
    return [
        clause.strip()
        for clause in re.split(r"[，。；,;!?！？\n]+", text)
        if clause.strip()
    ]


def _price_fact(
    text: str,
    patterns: list[str],
    *,
    negation_guard: bool,
) -> tuple[bool, str | None]:
    text_cf = text.casefold()
    for pattern in patterns:
        cleaned = normalize_text(pattern)
        if not cleaned:
            continue
        numeric = bool(re.fullmatch(r"\d+(?:\.\d+)?", cleaned))
        escaped = re.escape(cleaned)
        if numeric:
            pattern_re = re.compile(rf"(?<![0-9.]){escaped}(?![0-9.]){PRICE_SUFFIX}")
        else:
            pattern_re = re.compile(rf"{escaped}{PRICE_SUFFIX}")
        for match in pattern_re.finditer(text_cf):
            before = text_cf[max(0, match.start() - 12) : match.start()]
            negated = any(term in before for term in NEGATION_TERMS)
            if negation_guard and negated:
                continue
            return True, text[match.start() : match.end()].strip()
    return False, None


def _groups_fact(text: str, groups: list[list[str]]) -> tuple[bool, str | None]:
    for clause in _clauses(text):
        clause_cf = clause.casefold()
        if all(any(_casefold(word) in clause_cf for word in group) for group in groups):
            return True, clause
    return False, None


def fact_results(rubric: dict[str, Any], text: str) -> list[FactCheckResult]:
    results: list[FactCheckResult] = []
    for fact in rubric.get("required_facts", []):
        if fact.get("type") == "price":
            hit, evidence = _price_fact(
                text,
                list(fact.get("patterns") or []),
                negation_guard=bool(fact.get("negation_guard", False)),
            )
        else:
            hit, evidence = _groups_fact(text, list(fact.get("groups") or []))
        results.append(
            FactCheckResult(
                key=fact["key"],
                label=fact["label"],
                required=bool(fact.get("required", True)),
                status="hit" if hit else "missed",
                evidence=evidence if hit else None,
            )
        )
    return results


def redline_results(rubric: dict[str, Any], text: str) -> list[RedlineResult]:
    text_cf = text.casefold()
    hits: list[RedlineResult] = []
    seen: set[str] = set()
    for rule in rubric.get("redlines", []):
        term = str(rule.get("term", ""))
        if not term or term in seen:
            continue
        if _casefold(term) in text_cf:
            seen.add(term)
            hits.append(
                RedlineResult(
                    term=term,
                    reason=str(rule.get("reason", "")),
                    evidence=term,
                )
            )
    return hits


def dimension_hits(rubric: dict[str, Any], text: str) -> dict[str, list[str]]:
    text_cf = text.casefold()
    hits: dict[str, list[str]] = {}
    for key, dimension in rubric.get("dimensions", {}).items():
        keywords = [
            keyword
            for keyword in dimension.get("keywords", [])
            if _casefold(keyword) in text_cf
        ]
        hits[key] = list(dict.fromkeys(keywords))
    return hits


class DeterministicScorer:
    """可重复的模型替身：按绑定规则生成候选，不计算分数。"""

    async def propose(
        self,
        *,
        rubric: dict[str, Any],
        question_variant: str,
        answer_text: str,
    ) -> ModelScoringOutput:
        _ = question_variant
        text = normalize_text(answer_text)
        facts = fact_results(rubric, text)
        return ModelScoringOutput(
            hits=dimension_hits(rubric, text),
            fact_checks=[
                ModelFactCheck(
                    key=fact.key,
                    status=fact.status,
                    evidence=fact.evidence,
                )
                for fact in facts
            ],
            redline_hits=[
                ModelRedlineHit(term=hit.term, evidence=hit.evidence)
                for hit in redline_results(rubric, text)
            ],
        )


def _round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def _clamp(value: float) -> int:
    return max(40, min(99, _round_half_up(value)))


def _advice(
    redline_hits: list[RedlineResult],
    missed: list[FactCheckResult],
    weakest: DimensionScore,
) -> str:
    if redline_hits:
        terms = "、".join(f"「{item.term}」" for item in redline_hits)
        return f"当前话术命中红线{terms}，请立即停止使用并重新学习合规话术。"
    if missed:
        labels = "、".join(f"「{item.label}」" for item in missed)
        return f"当前漏讲必考事实{labels}，请补齐后再复练。"
    if weakest.score < 90:
        return f"当前【{weakest.name}】偏弱（{weakest.score} 分），建议巩固后再复练。"
    return "四维表达均衡，必考价格与核心规则逐项核对通过，达到金牌导购标准。"


def verify_and_score(
    rubric: dict[str, Any],
    answer_text: str,
    output: ModelScoringOutput,
) -> ScoringResult:
    """核验模型候选并按 M1 §8.3 计算正式结果。"""
    text = normalize_text(answer_text)
    text_cf = text.casefold()
    dimensions = rubric.get("dimensions", {})

    validated_hits: dict[str, list[str]] = {}
    for dimension_key, keywords in output.hits.items():
        if dimension_key not in dimensions:
            raise ScoringInvalidOutputError(f"未知维度 {dimension_key}")
        allowed = set(dimensions[dimension_key].get("keywords", []))
        for keyword in keywords:
            if keyword not in allowed:
                raise ScoringInvalidOutputError(f"关键词不在规则中：{keyword}")
            if _casefold(keyword) not in text_cf:
                raise ScoringInvalidOutputError(f"关键词未出现在原文中：{keyword}")
        validated_hits[dimension_key] = list(dict.fromkeys(keywords))

    expected_facts = {fact.key: fact for fact in fact_results(rubric, text)}
    provided_fact_keys = [fact.key for fact in output.fact_checks]
    if len(provided_fact_keys) != len(set(provided_fact_keys)):
        raise ScoringInvalidOutputError("事实检查重复")
    if set(provided_fact_keys) != set(expected_facts):
        raise ScoringInvalidOutputError("事实检查未覆盖全部事实键")

    for provided in output.fact_checks:
        expected = expected_facts[provided.key]
        if provided.status != expected.status:
            raise ScoringInvalidOutputError(f"事实结论与规则不符：{provided.key}")
        if provided.status == "hit":
            if not provided.evidence or _casefold(provided.evidence) not in text_cf:
                raise ScoringInvalidOutputError(f"事实证据缺失或不在原文：{provided.key}")
        elif provided.evidence is not None:
            raise ScoringInvalidOutputError(f"漏讲事实不应带证据：{provided.key}")

    expected_redlines = {item.term: item for item in redline_results(rubric, text)}
    provided_redline_terms = [item.term for item in output.redline_hits]
    if len(provided_redline_terms) != len(set(provided_redline_terms)):
        raise ScoringInvalidOutputError("红线检查重复")
    if set(provided_redline_terms) != set(expected_redlines):
        raise ScoringInvalidOutputError("红线检查与规则不符")
    for provided in output.redline_hits:
        if _casefold(provided.evidence) not in text_cf:
            raise ScoringInvalidOutputError(f"红线证据不在原文：{provided.term}")

    missed_required = [
        fact for fact in expected_facts.values() if fact.status == "missed"
    ]
    redline_hits = list(expected_redlines.values())
    hit_count = {
        key: len(validated_hits.get(key, [])) for key in DIMENSION_ORDER
    }
    redline_count = len(redline_hits)
    missed_count = len(missed_required)
    text_len = len(text)
    scores = {
        "selling": _clamp(
            52
            + 16 * hit_count["selling"]
            - 10 * missed_count
            - (30 if redline_count else 0)
        ),
        "objection": _clamp(
            50 + 16 * hit_count["objection"] - (15 if redline_count else 0)
        ),
        "cross_sell": _clamp(48 + 17 * hit_count["cross_sell"]),
        "affinity": _clamp(
            58 + 10 * hit_count["affinity"] + (10 if text_len >= 24 else 0)
        ),
    }
    weights = rubric.get("weights", {})
    total = _round_half_up(
        sum(float(weights.get(key, 0)) * scores[key] for key in DIMENSION_ORDER)
    )
    threshold = int(rubric.get("pass_threshold", 85))
    passed = total >= threshold and not redline_hits and not missed_required

    dims = [
        DimensionScore(
            key=key,
            name=dimensions[key].get("label", key),
            score=scores[key],
        )
        for key in DIMENSION_ORDER
    ]
    order_index = {key: index for index, key in enumerate(DIMENSION_ORDER)}
    weakest = min(dims, key=lambda item: (item.score, order_index[item.key]))
    missed_facts = [
        FactRef(key=fact.key, label=fact.label) for fact in missed_required
    ]
    return ScoringResult(
        threshold=threshold,
        total=total,
        passed=passed,
        dims=dims,
        fact_checks=list(expected_facts.values()),
        missed_required_facts=missed_facts,
        missed_facts=missed_facts,
        redline_hits=redline_hits,
        weakest=weakest,
        advice=_advice(redline_hits, missed_required, weakest),
        demo_pitch=str(rubric.get("demo_pitch", "")),
    )


def build_scoring_graph(scorer: Scorer):
    async def propose_node(state: ScoringState) -> dict[str, Any]:
        output = await scorer.propose(
            rubric=state["rubric"],
            question_variant=state["question_variant"],
            answer_text=state["answer_text"],
        )
        return {"model_output": output.model_dump(mode="json")}

    async def verify_node(state: ScoringState) -> dict[str, Any]:
        try:
            output = ModelScoringOutput.model_validate(state["model_output"])
            result = verify_and_score(
                state["rubric"],
                state["answer_text"],
                output,
            )
        except (ValidationError, ScoringInvalidOutputError) as exc:
            raise ScoringInvalidOutputError(str(exc)) from exc
        return {"result": result.model_dump(mode="json")}

    graph = StateGraph(ScoringState)
    graph.add_node("propose", propose_node)
    graph.add_node("verify", verify_node)
    graph.add_edge(START, "propose")
    graph.add_edge("propose", "verify")
    graph.add_edge("verify", END)
    return graph.compile()


DEFAULT_SCORING_GRAPH = build_scoring_graph(DeterministicScorer())


async def score_answer(
    rubric: dict[str, Any],
    question_variant: str,
    answer_text: str,
    *,
    graph=None,
) -> ScoringResult:
    active_graph = graph or DEFAULT_SCORING_GRAPH
    state = await active_graph.ainvoke(
        {
            "rubric": rubric,
            "question_variant": question_variant,
            "answer_text": answer_text,
        }
    )
    return ScoringResult.model_validate(state["result"])