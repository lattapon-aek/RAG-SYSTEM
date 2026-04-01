"""
LLMRerankerModel — LLM-based reranker using a graded scoring rubric (0–10 scale).
Adapted from the customer-support prompt pattern for general knowledge-base RAG.

Backend: any OpenAI-compatible endpoint (Ollama, OpenAI, etc.)
Scores are normalized to [0, 1] for compatibility with the rest of the pipeline.
"""
import json
import logging
import os
import re
import textwrap
from typing import List, Optional

import httpx

from application.ports import IRerankerModel
from domain.entities import RerankCandidate, RerankedResult
from domain.errors import RerankError

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = textwrap.dedent("""\
You are a knowledge-base relevance scoring service. Your task is to evaluate \
retrieved passages and score their relevance to a given query for a \
retrieval-augmented generation (RAG) system.

Evaluation Process:
1. Analyze the query to identify both explicit needs and implicit intent, \
including underlying user goals.
2. Assess each passage's ability to directly resolve the query or provide \
substantive, actionable supporting information.
3. Score based on how effectively the passage addresses the query's core intent.

Grading Criteria:
<grading_scale>
10: EXCEPTIONAL — Passage contains the exact answer with all required details. \
Completely resolves the query without ambiguity.

9: NEAR-PERFECT — Contains all critical information but may lack one minor detail. \
Directly applicable without adaptation.

8: STRONG MATCH — Provides complete resolution but may require a simple logical \
inference. Covers all essential components.

7: GOOD MATCH — Contains substantial relevant details but lacks one important \
element. Provides concrete guidance needing minor interpretation.

6: PARTIAL MATCH — General guidance on the right topic but lacks specifics for \
direct application. May only resolve a subset of the request.

5: LIMITED RELEVANCE — Related context but indirect. Requires substantial effort \
to adapt to the exact need.

4: TANGENTIAL — Mentions related concepts with little practical connection. \
Minimal actionable value.

3: VAGUE — Talks about the general domain but not the query's specifics.

2: TOKEN OVERLAP — Shares isolated terms without aligned intent.

1: IRRELEVANT — Uses query terms in an unrelated way.

0: UNRELATED — No thematic or contextual connection to the query.
</grading_scale>

Input Format:
<query>
// The user's question or request
</query>
<passages>
<passage id='id0'>...</passage>
<passage id='id1'>...</passage>
...
</passages>

Output Format:
Return ONLY a valid compact JSON object mapping passage IDs to integer scores.
- Keys must be passage IDs in the format "idN"
- Scores must be integers 5–10; EXCLUDE passages scoring below 5
- No decimals, no extra text, no formatting
- If NO passages score 5+, return: {}

Example: {"id0":8,"id2":6}
""").strip()


def _build_user_prompt(query: str, candidates: List[RerankCandidate]) -> str:
    passages = "\n".join(
        f"<passage id='id{i}'>{c.text[:600].strip()}</passage>"
        for i, c in enumerate(candidates)
    )
    return f"<query>\n{query}\n</query>\n<passages>\n{passages}\n</passages>"


def _parse_scores(raw: str) -> dict:
    """Extract JSON from LLM response, tolerating minor formatting issues."""
    # Strip think tags (qwen3 etc.)
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    # Find first { ... } block
    match = re.search(r"\{[^{}]*\}", raw, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return {}


class LLMRerankerModel(IRerankerModel):
    """
    LLM-based reranker. Scores are returned on a 0–10 integer scale and
    normalized to [0, 1] so downstream threshold comparisons work unchanged.

    Passages scoring below 5 are excluded (assigned score 0.0).
    """

    def __init__(
        self,
        base_url: str = "http://ollama:11434",
        model: str = "qwen3:0.6b",
        max_candidates: int = 8,
        api_key: str = "",
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._max_candidates = max_candidates
        self._api_key = api_key.strip()
        self._timeout = timeout

    def _chat_endpoint(self) -> str:
        base = self._base_url
        if base.endswith("/v1"):
            return f"{base}/chat/completions"
        if "/v1/" in base:
            return f"{base.rstrip('/')}/chat/completions"
        if base.endswith("/api"):
            return f"{base}/chat"
        if base.endswith("/api/chat"):
            return base
        if "opentyphoon" in base or "openai" in base:
            return f"{base}/chat/completions"
        return f"{base}/api/chat"

    async def rerank(
        self,
        query: str,
        candidates: List[RerankCandidate],
        top_n: int,
    ) -> List[RerankedResult]:
        if not candidates:
            return []

        limited = candidates[: self._max_candidates]
        user_prompt = _build_user_prompt(query, limited)

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                headers = {}
                if self._api_key:
                    headers["Authorization"] = f"Bearer {self._api_key}"
                    headers["api-key"] = self._api_key
                payload = {
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "stream": False,
                    "temperature": 0,
                    "max_tokens": 256,
                }
                resp = await client.post(
                    self._chat_endpoint(),
                    json=payload,
                    headers=headers,
                )
                resp.raise_for_status()
                body = resp.json()
                raw = ""
                if isinstance(body, dict):
                    if "choices" in body:
                        choices = body.get("choices") or []
                        if choices:
                            raw = choices[0].get("message", {}).get("content", "") or ""
                    elif "message" in body:
                        raw = body.get("message", {}).get("content", "") or ""
        except Exception as exc:
            raise RerankError(f"LLM reranker HTTP error: {exc}") from exc

        scores_map = _parse_scores(raw)
        logger.debug("LLM reranker raw scores: %s", scores_map)

        # Build results: passages with score >= 5 get normalized score, others 0.0
        scored: List[tuple] = []
        for i, candidate in enumerate(limited):
            key = f"id{i}"
            raw_score = scores_map.get(key)
            if raw_score is not None and isinstance(raw_score, (int, float)) and raw_score >= 5:
                normalized = float(raw_score) / 10.0
            else:
                normalized = 0.0
            scored.append((candidate, normalized))

        scored.sort(key=lambda x: x[1], reverse=True)
        results = []
        for new_rank, (candidate, score) in enumerate(scored[:top_n]):
            orig_rank = limited.index(candidate)
            results.append(RerankedResult(
                id=candidate.id,
                text=candidate.text,
                score=score,
                original_rank=orig_rank,
                reranked_rank=new_rank,
                metadata=candidate.metadata,
            ))
        return results

    @property
    def model_name(self) -> str:
        return f"llm:{self._model}"
