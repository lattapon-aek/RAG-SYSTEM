"""
Shared LLM service adapters used by multiple services.

These adapters intentionally avoid importing service-local modules so they can
be reused from any container that mounts only /app/shared.
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator, Optional, Protocol

import httpx

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0

_DEFAULT_SYSTEM = (
    "/no_think You are a helpful assistant. "
    "Answer questions based ONLY on the provided context. "
    "If the context does not contain enough information, say so clearly."
)


class ILLMService(Protocol):
    async def generate(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 512) -> str:
        ...

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        ...


async def _retry(coro_fn, retries: int = _MAX_RETRIES):
    last_error: Exception = RuntimeError("No attempts")
    for attempt in range(retries):
        try:
            return await coro_fn()
        except Exception as exc:
            last_error = exc
            wait = _BACKOFF_BASE ** attempt
            logger.warning("LLM attempt %d failed: %s — retrying in %.1fs", attempt + 1, exc, wait)
            await asyncio.sleep(wait)
    raise last_error


class OllamaLLMService:
    """Default local LLM via Ollama."""

    def __init__(self, base_url: str = "http://ollama:11434", model: str = "llama3.2"):
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def generate(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 512) -> str:
        system = system_prompt or _DEFAULT_SYSTEM

        async def _call():
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    f"{self._base_url}/api/chat",
                    json={
                        "model": self._model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": prompt},
                        ],
                        "stream": False,
                        "keep_alive": -1,
                        "options": {"num_predict": max_tokens, "num_ctx": 8192},
                    },
                )
                response.raise_for_status()
                content = response.json()["message"]["content"]
                import re as _re

                content = _re.sub(r"<think>.*?</think>", "", content, flags=_re.DOTALL).strip()
                return content

        return await _retry(_call, retries=1)

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        system = system_prompt or _DEFAULT_SYSTEM
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/api/chat",
                json={
                    "model": self._model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "stream": True,
                    "options": {"num_predict": max_tokens},
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        import json

                        data = json.loads(line)
                        token = data.get("message", {}).get("content", "")
                        if token:
                            yield token


class OpenAILLMService:
    def __init__(self, api_key: str, model: str = "gpt-4o-mini", base_url: Optional[str] = None):
        try:
            from openai import AsyncOpenAI

            kwargs = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self._client = AsyncOpenAI(**kwargs)
        except ImportError:
            raise ImportError("openai package required: pip install openai")
        self._model = model

    async def generate(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1024) -> str:
        system = system_prompt or _DEFAULT_SYSTEM

        async def _call():
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content or ""

        return await _retry(_call)

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        system = system_prompt or _DEFAULT_SYSTEM
        stream = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta


class AnthropicLLMService:
    def __init__(self, api_key: str, model: str = "claude-3-haiku-20240307"):
        try:
            import anthropic

            self._client = anthropic.AsyncAnthropic(api_key=api_key)
        except ImportError:
            raise ImportError("anthropic package required: pip install anthropic")
        self._model = model

    async def generate(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1024) -> str:
        system = system_prompt or _DEFAULT_SYSTEM

        async def _call():
            response = await self._client.messages.create(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": prompt}],
            )
            return response.content[0].text

        return await _retry(_call)

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        system = system_prompt or _DEFAULT_SYSTEM
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield text


class AzureOpenAILLMService:
    def __init__(self, api_key: str, endpoint: str, deployment: str, api_version: str = "2024-02-01"):
        try:
            from openai import AsyncAzureOpenAI

            self._client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=endpoint,
                api_version=api_version,
            )
        except ImportError:
            raise ImportError("openai package required: pip install openai")
        self._deployment = deployment

    async def generate(self, prompt: str, system_prompt: Optional[str] = None, max_tokens: int = 1024) -> str:
        system = system_prompt or _DEFAULT_SYSTEM

        async def _call():
            response = await self._client.chat.completions.create(
                model=self._deployment,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=max_tokens,
            )
            return response.choices[0].message.content or ""

        return await _retry(_call)

    async def generate_stream(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 1024,
    ) -> AsyncIterator[str]:
        system = system_prompt or _DEFAULT_SYSTEM
        stream = await self._client.chat.completions.create(
            model=self._deployment,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
