"""
FeedparserAdapter — parses RSS/Atom feeds via feedparser.
"""
import asyncio
import logging
from typing import List

from application.ports.i_news_feed_parser import INewsFeedParser
from domain.entities import NewsArticle
from domain.errors import FeedParseError

logger = logging.getLogger(__name__)


class FeedparserAdapter(INewsFeedParser):
    async def parse(self, feed_url: str, max_items: int = 20) -> List[NewsArticle]:
        try:
            import feedparser

            loop = asyncio.get_event_loop()
            feed = await loop.run_in_executor(None, lambda: feedparser.parse(feed_url))

            if feed.bozo and not feed.entries:
                raise FeedParseError(f"Feed parse error for {feed_url}: {feed.bozo_exception}")

            articles = []
            for entry in feed.entries[:max_items]:
                published = None
                if hasattr(entry, "published"):
                    published = entry.published
                elif hasattr(entry, "updated"):
                    published = entry.updated

                content = ""
                if hasattr(entry, "content") and entry.content:
                    content = entry.content[0].get("value", "")
                elif hasattr(entry, "summary"):
                    content = entry.summary

                articles.append(NewsArticle(
                    title=entry.get("title", ""),
                    url=entry.get("link", ""),
                    summary=entry.get("summary", ""),
                    published=published,
                    source=feed.feed.get("title", feed_url),
                    content=content,
                ))
            return articles
        except FeedParseError:
            raise
        except Exception as exc:
            raise FeedParseError(f"Failed to parse feed {feed_url}: {exc}") from exc
