from abc import ABC, abstractmethod
from typing import List
from domain.entities import NewsArticle


class INewsFeedParser(ABC):
    @abstractmethod
    async def parse(self, feed_url: str, max_items: int = 20) -> List[NewsArticle]:
        """Parse an RSS/Atom feed and return articles."""
