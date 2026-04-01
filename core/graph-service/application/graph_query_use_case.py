import logging
import re
from typing import List

from application.ports.i_graph_repository import IGraphRepository
from domain.entities import GraphQuery, GraphQueryResult

logger = logging.getLogger(__name__)


class GraphQueryUseCase:
    _STOPWORDS = {
        "ใคร", "อะไร", "ที่ไหน", "เมื่อไร", "ทำไม", "อย่างไร",
        "who", "what", "where", "when", "why", "how",
        "query", "question",
    }
    _MULTI_SPLIT_MARKERS = ("กับ", "และ", "ร่วมกับ", "คู่กับ", "ระหว่าง", "/", "&", ",")
    _NAME_MARKERS = (
        "เป็นใคร", "คือใคร", "เป็นอะไร", "คืออะไร", "ใครเป็น", "ใครคือ",
        "ทำงาน", "ทำงานกับ", "อยู่", "อยู่กับ", "มี", "รับผิดชอบ",
        "ดูแล", "ทำหน้าที่", "วิเคราะห์", "วางแผน", "จัดสรร", "ตัดสินใจ",
    )

    def __init__(self, repository: IGraphRepository):
        self._repository = repository

    @classmethod
    def _clean_candidate(cls, value: str) -> str:
        cleaned = re.sub(r"\s+", " ", value).strip(" \t\r\n,.;:，。'\"`")
        cleaned = re.sub(r"\s+(?:ครับ|ค่ะ|คะ|จ้ะ|นะ)$", "", cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    @classmethod
    def _extract_entity_candidates(cls, query_text: str) -> List[str]:
        cleaned = (query_text or "").strip()
        if not cleaned:
            return []

        seeds: List[str] = []

        for token in re.findall(r"\b[A-Z]{2,}\b", cleaned):
            if token not in seeds:
                seeds.append(token)

        compact = re.sub(r"\s+", "", cleaned)
        if compact:
            for marker in cls._NAME_MARKERS:
                if marker in compact:
                    prefix = compact.split(marker, 1)[0].strip(" ,.;:，。")
                    if prefix and prefix.lower() not in cls._STOPWORDS:
                        split_parts = [
                            cls._clean_candidate(part)
                            for part in re.split(r"(?:กับ|และ|ร่วมกับ|คู่กับ|/|&|,)", prefix)
                        ]
                        for candidate in split_parts:
                            if (
                                candidate
                                and candidate.lower() not in cls._STOPWORDS
                                and len(candidate) <= 32
                                and not re.search(r"(เป็น|คือ|ทำงาน|ร่วม|อยู่|มี|รับผิดชอบ|ดูแล|ทำหน้าที่|วิเคราะห์|วางแผน|จัดสรร|ตัดสินใจ)", candidate)
                                and candidate not in seeds
                            ):
                                seeds.append(candidate)
                    break

        if compact and len(cleaned.split()) == 1 and compact.lower() not in cls._STOPWORDS:
            if (
                re.search(r"[A-Za-zก-๙]", compact)
                and not re.search(r"(เป็น|คือ|ทำงาน|ร่วม|อยู่|มี|รับผิดชอบ|ดูแล|ทำหน้าที่|วิเคราะห์|วางแผน|จัดสรร|ตัดสินใจ|กับ|และ|ระหว่าง|เปรียบเทียบ|เทียบ)", compact)
            ):
                candidate = cls._clean_candidate(compact)
                if candidate and candidate.lower() not in cls._STOPWORDS:
                    seeds.append(candidate)

        return list(dict.fromkeys(seeds))

    async def execute(self, query: GraphQuery) -> GraphQueryResult:
        entity_names = query.entity_names
        if not entity_names and query.query_text.strip():
            entity_names = self._extract_entity_candidates(query.query_text)

        result = await self._repository.query_related_entities(
            entity_names=entity_names,
            max_hops=query.max_hops,
            namespace=query.namespace,
        )

        # If exact-id match returned nothing, try substring search as fallback
        if not result.entities and query.query_text.strip():
            result = await self._repository.search_entities_by_text(
                query_text=query.query_text.strip(),
                max_hops=query.max_hops,
                namespace=query.namespace,
            )

        return result
