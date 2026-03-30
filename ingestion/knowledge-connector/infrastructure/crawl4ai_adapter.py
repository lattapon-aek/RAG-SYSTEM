"""
Crawl4AIAdapter — scrapes web pages using crawl4ai, returns clean text.
Falls back to httpx + basic HTML stripping if crawl4ai unavailable.
"""
import logging
import re
from html import unescape
from typing import Any, Optional

from application.ports.i_web_scraper import IWebScraper
from domain.entities import PageMetadata, ScrapedPage
from domain.errors import BlockedDomainError, ScrapingError

logger = logging.getLogger(__name__)


def _is_blocked(url: str, blocklist: str) -> bool:
    """Check if URL matches any blocked domain/CIDR pattern."""
    for pattern in blocklist.split(","):
        pattern = pattern.strip()
        if pattern and pattern in url:
            return True
    return False


def _strip_html(html: str) -> str:
    """Minimal HTML tag stripper."""
    text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_attributes(tag: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in re.finditer(r'([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["\']([^"\']*)["\']', tag):
        attrs[match.group(1).lower()] = unescape(match.group(2).strip())
    return attrs


def _extract_first_tag(html: str, pattern: str) -> str:
    match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
    return unescape(match.group(1).strip()) if match else ""


def _extract_meta_map(html: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for match in re.finditer(r"<meta\b[^>]*>", html, flags=re.IGNORECASE | re.DOTALL):
        attrs = _parse_attributes(match.group(0))
        key = attrs.get("name") or attrs.get("property") or attrs.get("itemprop")
        content = attrs.get("content", "")
        if key and content:
          result[key.lower()] = content
    return result


def _extract_link_canonical(html: str) -> str:
    for match in re.finditer(r"<link\b[^>]*>", html, flags=re.IGNORECASE | re.DOTALL):
        attrs = _parse_attributes(match.group(0))
        rel = attrs.get("rel", "").lower()
        if "canonical" in rel.split():
            return attrs.get("href", "")
    return ""


def _extract_html_lang(html: str) -> str:
    match = re.search(r"<html\b[^>]*\blang\s*=\s*['\"]([^'\"]+)['\"]", html, flags=re.IGNORECASE | re.DOTALL)
    return unescape(match.group(1).strip()) if match else ""


def _build_metadata(
    url: str,
    html: str,
    text: str,
    status_code: int,
    content_type: str = "",
    base_metadata: Optional[dict[str, Any]] = None,
) -> PageMetadata:
    meta_map = _extract_meta_map(html)
    base_metadata = base_metadata or {}
    title = (
        base_metadata.get("title")
        or _extract_first_tag(html, r"<title[^>]*>(.*?)</title>")
        or meta_map.get("og:title")
        or ""
    )
    description = (
        base_metadata.get("description")
        or meta_map.get("description")
        or meta_map.get("og:description")
        or ""
    )
    author = (
        base_metadata.get("author")
        or meta_map.get("author")
        or meta_map.get("article:author")
        or ""
    )
    published_at = (
        base_metadata.get("published_at")
        or meta_map.get("article:published_time")
        or meta_map.get("date")
        or meta_map.get("publishdate")
    )
    canonical_url = (
        base_metadata.get("canonical_url")
        or _extract_link_canonical(html)
        or url
    )
    site_name = (
        base_metadata.get("site_name")
        or meta_map.get("og:site_name")
        or ""
    )
    language = base_metadata.get("language") or _extract_html_lang(html) or ""
    keywords_raw = base_metadata.get("keywords") or meta_map.get("keywords") or ""
    keywords = [k.strip() for k in str(keywords_raw).split(",") if k.strip()]

    preview_source = text.strip() or _strip_html(html)
    return PageMetadata(
        url=url,
        title=title,
        description=description,
        author=author,
        published_at=published_at,
        canonical_url=canonical_url,
        site_name=site_name,
        language=language,
        keywords=keywords,
        status_code=status_code,
        content_type=content_type,
        text_length=len(text.strip()),
        text_preview=preview_source[:1000],
        metadata={**base_metadata, **meta_map},
    )


class Crawl4AIAdapter(IWebScraper):
    def __init__(self, blocklist: str = "", timeout: float = 30.0) -> None:
        self._blocklist = blocklist
        self._timeout = timeout

    async def inspect(self, url: str) -> PageMetadata:
        if self._blocklist and _is_blocked(url, self._blocklist):
            raise BlockedDomainError(f"Domain blocked: {url}")

        try:
            from crawl4ai import AsyncWebCrawler
            async with AsyncWebCrawler(verbose=False) as crawler:
                result = await crawler.arun(url=url)
                html = result.html or ""
                text = result.markdown or result.cleaned_html or ""
                metadata = getattr(result, "metadata", {}) or {}
                return _build_metadata(
                    url=url,
                    html=html,
                    text=text,
                    status_code=result.status_code or 200,
                    base_metadata=metadata,
                )
        except ImportError:
            logger.warning("crawl4ai not available, falling back to httpx")
            return await self._httpx_inspect(url)
        except BlockedDomainError:
            raise
        except Exception as exc:
            raise ScrapingError(f"Metadata inspection failed for {url}: {exc}") from exc

    async def scrape(self, url: str) -> ScrapedPage:
        if self._blocklist and _is_blocked(url, self._blocklist):
            raise BlockedDomainError(f"Domain blocked: {url}")

        try:
            from crawl4ai import AsyncWebCrawler
            async with AsyncWebCrawler(verbose=False) as crawler:
                result = await crawler.arun(url=url)
                text = result.markdown or result.cleaned_html or ""
                metadata = getattr(result, "metadata", {}) or {}
                return ScrapedPage(
                    url=url,
                    title=metadata.get("title", "") if metadata else "",
                    text=text,
                    html=result.html or "",
                    status_code=result.status_code or 200,
                    metadata=_build_metadata(
                        url=url,
                        html=result.html or "",
                        text=text,
                        status_code=result.status_code or 200,
                        base_metadata=metadata,
                    ).metadata,
                )
        except ImportError:
            # Fallback: plain httpx fetch
            logger.warning("crawl4ai not available, falling back to httpx")
            return await self._httpx_fallback(url)
        except BlockedDomainError:
            raise
        except Exception as exc:
            raise ScrapingError(f"Scraping failed for {url}: {exc}") from exc

    async def _httpx_inspect(self, url: str) -> PageMetadata:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True, verify=False) as client:
                resp = await client.get(url, headers={"User-Agent": "RAG-Connector/1.0"})
                resp.raise_for_status()
                html = resp.text
                text = _strip_html(html)
                return _build_metadata(
                    url=url,
                    html=html,
                    text=text,
                    status_code=resp.status_code,
                    content_type=resp.headers.get("content-type", ""),
                )
        except Exception as exc:
            raise ScrapingError(f"HTTP metadata fetch failed for {url}: {exc}") from exc

    async def _httpx_fallback(self, url: str) -> ScrapedPage:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True,
                                         verify=False) as client:
                resp = await client.get(url, headers={"User-Agent": "RAG-Connector/1.0"})
                resp.raise_for_status()
                html = resp.text
                text = _strip_html(html)
                metadata = _build_metadata(
                    url=url,
                    html=html,
                    text=text,
                    status_code=resp.status_code,
                    content_type=resp.headers.get("content-type", ""),
                )
                return ScrapedPage(url=url, title=metadata.title, text=text, html=html,
                                   status_code=resp.status_code, metadata=metadata.metadata)
        except Exception as exc:
            raise ScrapingError(f"HTTP fetch failed for {url}: {exc}") from exc
