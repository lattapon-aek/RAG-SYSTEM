"""Provider-neutral LLM client for drafting knowledge gap answers."""
import logging
import sys
from pathlib import Path

def _add_shared_path() -> None:
    base = Path(__file__).resolve()
    candidates = [
        base.parent.parent / "shared",
        base.parent.parent.parent / "shared",
        base.parent.parent.parent.parent / "shared",
        Path("/app/shared"),
    ]
    for candidate in candidates:
        candidate_str = str(candidate)
        if candidate.exists() and candidate_str not in sys.path:
            sys.path.insert(0, candidate_str)


_add_shared_path()

from model_config import build_model_config
from provider_factory import create_chat_llm_service

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are a helpful knowledge base assistant. "
    "Given a question and web search results, write a concise, factual answer "
    "that could be added to a knowledge base. "
    "Use only the provided search results. Be specific and accurate. "
    "Do not mention that you are an AI or that these are search results."
)


class OllamaLLMClient:
    def __init__(self, base_url: str | None = None, model: str | None = None):
        cfg = build_model_config()
        provider = cfg["gap_draft_llm_provider"]
        self._llm = create_chat_llm_service(
            provider=provider,
            model=model or cfg["gap_draft_llm_model"],
            ollama_base_url=(base_url or cfg["ollama_base_url"]).rstrip("/"),
            openai_api_key=cfg["openai_api_key"],
            typhoon_api_key=cfg["typhoon_api_key"],
            typhoon_base_url=cfg["typhoon_base_url"],
            anthropic_api_key=cfg["anthropic_api_key"],
            azure_api_key=cfg["azure_api_key"],
            azure_endpoint=cfg["azure_endpoint"],
            azure_deployment=cfg["azure_deployment"],
        )

    async def draft_answer(self, query: str, search_results: list[dict]) -> str:
        """Draft a knowledge base answer from web search results."""
        if not search_results:
            return ""

        snippets = []
        for i, r in enumerate(search_results[:5], 1):
            title = r.get("title", "")
            snippet = r.get("snippet", r.get("content", ""))
            url = r.get("url", r.get("link", ""))
            if snippet:
                snippets.append(f"[{i}] {title}\n{snippet}\nSource: {url}")

        context = "\n\n".join(snippets)
        user_message = f"Question: {query}\n\nSearch results:\n{context}\n\nWrite a knowledge base answer:"
        try:
            return (await self._llm.generate(
                user_message,
                system_prompt=_SYSTEM_PROMPT,
                max_tokens=512,
            )).strip()
        except Exception as exc:
            logger.warning("LLM draft_answer failed: %s", exc)
            return ""
