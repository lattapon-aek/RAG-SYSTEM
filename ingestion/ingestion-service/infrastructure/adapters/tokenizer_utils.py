import logging
import re
from typing import Any

import tiktoken

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"\S+|\s+")


class FallbackEncoder:
    """Offline-safe tokenizer fallback.

    It preserves text by splitting into alternating whitespace and non-whitespace
    segments, which is sufficient for chunk sizing and round-tripping text when
    the tiktoken asset cannot be downloaded during container startup.
    """

    def encode(self, text: str) -> list[str]:
        return _TOKEN_RE.findall(text)

    def decode(self, tokens: list[Any]) -> str:
        return "".join(str(token) for token in tokens)


def get_encoder():
    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception as exc:
        logger.warning("Falling back to offline tokenizer: %s", exc)
        return FallbackEncoder()
