"""
Context Compressor strategies
- NoOpCompressor: pass-through
- ExtractiveCompressor: score sentences, retain above threshold
- LLMCompressor: compress the assembled context once into a strict template
"""
import os
import logging
import re
from typing import List, Optional, Dict

import tiktoken

try:
    from application.ports.i_context_compressor import IContextCompressor
    from application.ports.i_llm_service import ILLMService
    from domain.entities import BuiltContext, CompressedContext
except ImportError:
    from application.ports.i_context_compressor import IContextCompressor  # type: ignore
    from application.ports.i_llm_service import ILLMService  # type: ignore
    from domain.entities import BuiltContext, CompressedContext  # type: ignore

logger = logging.getLogger(__name__)

_DEFAULT_COMPRESSION_LLM_SYSTEM_PROMPT = (
    "You are a strict context brief formatter for a retrieval-based AI system. "
    "Use ONLY the provided context. "
    "Do not answer from outside knowledge. "
    "Do not infer missing facts. "
    "Do not expose raw graph dumps, raw triples, or verbose provenance. "
    "Prefer concise, reusable summaries that another agent can reason over. "
    "If the context is insufficient, say Unknown or Needs validation. "
    "If more than one interpretation is possible, state that clearly instead of choosing one. "
    "Keep the output neutral and domain-agnostic. "
    "Return one clean template only."
)

_DEFAULT_COMPRESSION_LLM_PROMPT = (
    "Compress the structured context into one neutral downstream brief.\n"
    "Use ONLY the provided context and the query.\n"
    "Do not invent, expand, or rewrite with external knowledge.\n"
    "Do not output raw graph triples, raw IDs, or provenance dumps.\n"
    "Do not produce more than one template.\n"
    "Do not output any preface, explanation, or commentary outside the template.\n"
    "Prefer short, non-redundant bullets.\n"
    "Put only factual statements in Facts.\n"
    "Put only dependency or relationship summaries in Relationships.\n"
    "Do not include Notes.\n"
    "If information is missing or unclear, omit it rather than filling space.\n"
    "If multiple interpretations exist, list them separately and keep them short.\n"
    "Keep the result reusable for another agent.\n\n"
    "Return EXACTLY this template and nothing else:\n"
    "Query: <the user query>\n"
    "Facts:\n"
    "- <concise trusted facts from retrieval or memory, or None>\n"
    "Relationships:\n"
    "- <concise relation summaries or dependency chains, or None>\n\n"
    "Query: {query}\n\n"
    "Structured Context:\n"
    "{text}\n\n"
    "Template:"
)


class NoOpCompressor(IContextCompressor):
    """Pass-through — returns context as-is."""

    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        full_text = "\n\n".join(c.text for c in context.chunks)
        return CompressedContext(
            text=full_text,
            original_tokens=context.total_tokens,
            compressed_tokens=context.total_tokens,
            method="none",
        )


class ExtractiveCompressor(IContextCompressor):
    """Score sentences by keyword overlap with query, retain above threshold."""

    def __init__(self, threshold: float = 0.1, encoding: str = "cl100k_base"):
        self._threshold = threshold
        self._enc = tiktoken.get_encoding(encoding)

    def _score_sentence(self, sentence: str, query_words: set) -> float:
        words = set(sentence.lower().split())
        if not words:
            return 0.0
        return len(words & query_words) / len(words)

    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        query_words = set(query.lower().split())
        retained: List[str] = []
        original_tokens = context.total_tokens

        for chunk in context.chunks:
            sentences = re.split(r'(?<=[.!?])\s+', chunk.text)
            for sentence in sentences:
                if self._score_sentence(sentence, query_words) >= self._threshold:
                    retained.append(sentence)

        compressed_text = " ".join(retained)
        compressed_tokens = len(self._enc.encode(compressed_text))

        return CompressedContext(
            text=compressed_text,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
            method="extractive",
        )


class LLMCompressor(IContextCompressor):
    """Compress the assembled context once with LLM conditioned on the query."""

    def __init__(
        self,
        llm: ILLMService,
        encoding: str = "cl100k_base",
        system_prompt: Optional[str] = None,
    ):
        self._llm = llm
        self._enc = tiktoken.get_encoding(encoding)
        env_prompt = os.getenv("COMPRESSION_LLM_SYSTEM_PROMPT", "").strip()
        self._system_prompt = (
            system_prompt.strip()
            if system_prompt and system_prompt.strip()
            else (env_prompt or _DEFAULT_COMPRESSION_LLM_SYSTEM_PROMPT)
        )

    def _assemble_context_text(self, context: BuiltContext) -> str:
        if len(context.chunks) == 1:
            return context.chunks[0].text.strip()

        parts: List[str] = []
        for i, chunk in enumerate(context.chunks, start=1):
            header_bits = [f"Chunk {i}"]
            if getattr(chunk, "chunk_id", None):
                header_bits.append(f"chunk_id={chunk.chunk_id}")
            if getattr(chunk, "document_id", None):
                header_bits.append(f"document_id={chunk.document_id}")
            if getattr(chunk, "namespace", None):
                header_bits.append(f"namespace={chunk.namespace}")
            header = " | ".join(header_bits)
            parts.append(f"[{header}]\n{chunk.text.strip()}")
        return "\n\n".join(parts).strip()

    @staticmethod
    def _split_template_sections(text: str) -> Dict[str, List[str]]:
        sections: Dict[str, List[str]] = {
            "Facts": [],
            "Relationships": [],
        }
        current: Optional[str] = None

        heading_patterns = {
            "Facts": re.compile(r"^Facts\s*:?\s*$", re.IGNORECASE),
            "Relationships": re.compile(r"^Relationships\s*:?\s*$", re.IGNORECASE),
        }

        for raw_line in text.splitlines():
            line = raw_line.rstrip()
            matched_heading = None
            for name, pattern in heading_patterns.items():
                if pattern.match(line.strip()):
                    matched_heading = name
                    break
            if matched_heading:
                current = matched_heading
                continue
            if current is None:
                continue
            sections[current].append(line)

        return sections

    @staticmethod
    def _split_context_sections(text: str) -> Dict[str, List[str]]:
        section_names = {
            "Query",
            "Scope",
            "Trusted Facts",
            "Graph Summary",
            "Entities / Actors",
            "Relationships / Connections",
            "Heuristics / Decision Rules",
            "Unknowns / Missing Information",
        }
        sections: Dict[str, List[str]] = {name: [] for name in section_names}
        current: Optional[str] = None
        for raw_line in (text or "").splitlines():
            line = raw_line.rstrip()
            header = line.strip()
            if header.startswith("[") and header.endswith("]"):
                header_name = header.strip("[]").strip()
                if header_name in sections:
                    current = header_name
                    continue
            if current is not None and header:
                sections[current].append(header)
        return sections

    @classmethod
    def _has_grounded_content(cls, source_text: str) -> bool:
        if not source_text.strip():
            return False
        has_structured_sections = any(
            marker in source_text for marker in (
                "[Trusted Facts]",
                "[Entities / Actors]",
                "[Relationships / Connections]",
            )
        )
        if not has_structured_sections:
            return True
        sections = cls._split_context_sections(source_text)
        return any(
            sections.get(name)
            for name in ("Trusted Facts", "Graph Summary", "Entities / Actors", "Relationships / Connections")
        )

    @staticmethod
    def _dedupe_preserve_order(lines: List[str]) -> List[str]:
        seen = set()
        result: List[str] = []
        for line in lines:
            cleaned = re.sub(r"\s+", " ", line).strip()
            if not cleaned:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(cleaned)
        return result

    @staticmethod
    def _normalize_list(lines: List[str], default: str, limit: int = 4) -> List[str]:
        cleaned: List[str] = []
        for line in lines:
            stripped = line.lstrip("-•* ").strip()
            if not stripped:
                continue
            if stripped.lower() == default.lower():
                continue
            cleaned.append(stripped)
        deduped = LLMCompressor._dedupe_preserve_order(cleaned)
        if not deduped:
            return [default]
        return deduped[:limit]

    @classmethod
    def _fallback_from_source(cls, source_text: str, query: str) -> str:
        sections = cls._split_context_sections(source_text)

        def _clean_bullets(lines: List[str], limit: int = 4) -> List[str]:
            cleaned: List[str] = []
            for line in lines:
                stripped = line.lstrip("-•* ").strip()
                if not stripped:
                    continue
                if stripped.startswith("[") and stripped.endswith("]"):
                    continue
                cleaned.append(stripped)
            return cls._dedupe_preserve_order(cleaned)[:limit]

        facts = _clean_bullets(sections.get("Trusted Facts", []), limit=4)
        graph_summary = _clean_bullets(sections.get("Graph Summary", []), limit=4)
        entities = _clean_bullets(sections.get("Entities / Actors", []), limit=8)
        relations = _clean_bullets(sections.get("Relationships / Connections", []), limit=6)

        if entities and not facts:
            facts = entities[:4]
        if graph_summary and not relations:
            relations = graph_summary[:4]
        if graph_summary and not facts:
            facts = graph_summary[:4]

        normalized = [
            f"Query: {query.strip() or 'Unknown'}",
            "Facts:",
            *[f"- {line}" for line in cls._normalize_list(facts, "None", limit=4)],
            "Relationships:",
            *[f"- {line}" for line in cls._normalize_list(relations, "None", limit=4)],
        ]
        return "\n".join(normalized)

    @classmethod
    def _normalize_template_output(cls, raw: str, query: str = "") -> str:
        text = (raw or "").strip()
        if not text:
            return cls._fallback_from_source("", query=query)

        text = re.sub(r"^```(?:text|markdown|md)?\s*|\s*```$", "", text, flags=re.IGNORECASE | re.DOTALL).strip()
        sections = cls._split_template_sections(text)
        if not any(sections.values()):
            return "\n".join(
                [
                    f"Query: {query.strip() or 'Unknown'}",
                    "Facts:",
                    f"- {text}" if text else "- None",
                    "Relationships:",
                    "- None",
                ]
            )

        def _block(title: str, lines: List[str], default: str) -> Optional[str]:
            content = [ln.strip() for ln in lines if ln.strip()]
            if not content:
                return None
            normalized_lines = []
            for line in content:
                stripped = line.lstrip("-•* ").strip()
                normalized_lines.append(f"- {stripped}" if stripped else f"- {default}")
            return title + ":\n" + "\n".join(normalized_lines)

        blocks: List[str] = [f"Query: {query.strip() or 'Unknown'}"]
        facts_block = _block("Facts", sections["Facts"], "None")
        rel_block = _block("Relationships", sections["Relationships"], "None")
        if facts_block:
            blocks.append(facts_block)
        else:
            blocks.append("Facts:\n- None")
        if rel_block:
            blocks.append(rel_block)
        else:
            blocks.append("Relationships:\n- None")
        return "\n".join(blocks)

    async def compress(self, query: str, context: BuiltContext,
                       max_tokens: int = 4096) -> CompressedContext:
        original_tokens = context.total_tokens
        source_text = self._assemble_context_text(context)
        if not self._has_grounded_content(source_text):
            return CompressedContext(
                text="",
                original_tokens=original_tokens,
                compressed_tokens=0,
                method="empty",
            )
        prompt_text = _DEFAULT_COMPRESSION_LLM_PROMPT.format(query=query, text=source_text)
        prompt_tokens = len(self._enc.encode(prompt_text))
        completion_budget = max(prompt_tokens + 64, min(max_tokens, 4096))

        try:
            summary = await self._llm.generate(
                prompt_text,
                system_prompt=self._system_prompt,
                max_tokens=completion_budget,
            )
            compressed_text = self._normalize_template_output(summary, query=query)
        except Exception as exc:
            logger.warning("LLM compression failed: %s", exc)
            compressed_text = self._normalize_template_output(source_text, query=query)

        compressed_tokens = len(self._enc.encode(compressed_text))

        return CompressedContext(
            text=compressed_text,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
            method="llm",
        )
