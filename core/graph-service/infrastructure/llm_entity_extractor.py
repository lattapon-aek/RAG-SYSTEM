"""
Hybrid entity and relation extractor for graph-service.

The extractor uses deterministic heuristics first for people/profile-style
documents, then falls back to the configured chat LLM if the heuristic pass
finds nothing. This keeps extraction usable for Thai team rosters without
requiring prompt tuning for every document set.
"""
import json
import logging
import os
import re
import uuid
import sys
from pathlib import Path
from typing import List, Tuple

from application.ports.i_entity_extractor import IEntityExtractor
from domain.entities import Entity, Relation

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

_DEFAULT_SYSTEM_PROMPT = """\
You are a domain-neutral knowledge graph extraction engine.
Given a text passage in any language, extract only the most relevant entities and the explicit or strongly implied relations between them.

Important:
- Preserve the original script exactly as it appears in the source text.
- Do not transliterate, translate, or normalize names into another language.
- Prefer exact surface forms from the passage, including Thai names and mixed-language tokens.
- Keep the output conservative: only extract entities and relations that are supported by the text.
- If the text is ambiguous, prefer fewer, higher-confidence entities over many speculative ones.

Return ONLY a valid JSON object with this exact structure:
{
  "entities": [
    {"id": "<lowercase_canonical_name>", "label": "<PERSON|ORG|LOCATION|CONCEPT>", "name": "<original name>"}
  ],
  "relations": [
    {"source": "<entity_id>", "target": "<entity_id>", "type": "<RELATION_TYPE>"}
  ]
}

Rules:
- entity id must be the lowercase version of the original name
- label must be one of: PERSON, ORG, LOCATION, CONCEPT
- use CONCEPT for roles, teams, systems, products, topics, or anything that does not clearly fit PERSON/ORG/LOCATION
- relation type must be UPPERCASE_SNAKE_CASE (for example WORKS_WITH, PART_OF, REPORTS_TO, LOCATED_IN, MENTIONS)
- prefer a small, stable relation vocabulary when possible:
  MEMBER_OF, PART_OF, HAS_ROLE, REPORTS_TO, WORKS_WITH, RESPONSIBLE_FOR, GOOD_FOR, ALIAS_OF, MENTIONS
- only include relations between entities that appear in the entities list
- if no entities are found, return {"entities": [], "relations": []}
- output ONLY the JSON object, no explanation, no markdown
"""

_RELATION_NORMALIZATION = {
    "ALIAS_OF": "ALIAS_OF",
    "BELONGS": "MEMBER_OF",
    "BELONGS_TO": "MEMBER_OF",
    "GOOD_FOR": "GOOD_FOR",
    "HAS_ROLE": "HAS_ROLE",
    "IS_MEMBER_OF": "MEMBER_OF",
    "MANAGES": "REPORTS_TO",
    "MENTIONS": "MENTIONS",
    "MEMBER_OF": "MEMBER_OF",
    "PART_OF": "PART_OF",
    "RESPONSIBLE_FOR": "RESPONSIBLE_FOR",
    "REPORTS_TO": "REPORTS_TO",
    "RELATED_TO": "RELATED_TO",
    "WORKS_WITH": "WORKS_WITH",
    "WORKS_IN": "PART_OF",
}


class LLMEntityExtractor(IEntityExtractor):
    """Hybrid extractor: heuristics first, LLM fallback when needed."""

    _UPPER_CONCEPT_RE = re.compile(r"\b[A-Z][A-Z0-9/_\-.]{1,19}\b")
    _HEADING_RE = re.compile(r"^##\s*(?P<title>.+?)\s*$")
    _HEADING_PERSON_RE = re.compile(
        r"^(?P<name>[^()\n]{2,80}?)(?:\s*\((?P<nickname>[^)]+)\))?$"
    )
    _NICKNAME_LINE_RE = re.compile(
        r"^(?P<name>[^()\n]{2,80}?)\s+ชื่อเล่น\s+(?P<nickname>[^()\n]{1,80}?)(?:\s*\(Email:.*)?$"
    )
    _ROLE_LINE_RE = re.compile(
        r"(?:ทำหน้าที่เป็น|เป็น|มีบทบาทหลักในการ|รับผิดชอบ|เหมาะกับ)\s+(?P<role>[^.。\\n]{3,120})"
    )
    _TEAM_CONTEXT_RE = re.compile(
        r"(?:\bทีม\b|\bteam\b)\s+(?P<team>[^,。.\n]{2,80})",
        re.IGNORECASE,
    )
    _TEAM_MEMBER_RE = re.compile(
        r"(?P<person>[^,。.\n]{2,80}?)\s+"
        r"(?:เป็นสมาชิก(?:ของ)?|อยู่(?:ใน)?|ทำงาน(?:อยู่)?ใน|สังกัด)\s+"
        r"(?:ทีม\s+|team\s+)?(?P<team>[^,。.\n]{2,80})",
        re.IGNORECASE,
    )
    _TEAM_STOP_RE = re.compile(
        r"\s+(?:รับผิดชอบ|ดูแล|ทำหน้าที่|มีบทบาท|เป็น|ช่วย|โดย|เพื่อ|ซึ่ง|ที่|เมื่อ|และ)",
        re.IGNORECASE,
    )

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 180.0,
    ):
        cfg = build_model_config()
        self._graph_llm_provider = cfg["graph_llm_provider"]
        self._graph_llm_model = model or cfg["graph_llm_model"]
        self._graph_llm_base_url = (base_url or cfg["ollama_base_url"]).rstrip("/")
        self._graph_llm_openai_api_key = cfg["openai_api_key"]
        self._graph_llm_typhoon_api_key = cfg["typhoon_api_key"]
        self._graph_llm_typhoon_base_url = cfg["typhoon_base_url"]
        self._graph_llm_anthropic_api_key = cfg["anthropic_api_key"]
        self._graph_llm_azure_api_key = cfg["azure_api_key"]
        self._graph_llm_azure_endpoint = cfg["azure_endpoint"]
        self._graph_llm_azure_deployment = cfg["azure_deployment"]
        self._llm = None
        self._timeout = timeout
        self._system_prompt = os.getenv("GRAPH_ENTITY_SYSTEM_PROMPT", _DEFAULT_SYSTEM_PROMPT)
        self.last_extraction_mode = "empty"
        self.last_heuristic_blocks = 0
        self.last_llm_blocks = 0
        self.last_total_blocks = 0

    async def extract(
        self, text: str, document_id: str
    ) -> Tuple[List[Entity], List[Relation]]:
        blocks = self._split_text(text)
        if not blocks:
            self.last_extraction_mode = "empty"
            self.last_heuristic_blocks = 0
            self.last_llm_blocks = 0
            self.last_total_blocks = 0
            return [], []

        all_entities: dict[str, Entity] = {}
        all_relations: dict[tuple[str, str, str], Relation] = {}
        heuristic_blocks = 0
        llm_blocks = 0
        document_team_ids: set[str] = set()

        for block in blocks:
            entities, relations = self._heuristic_extract(block, document_id)
            block_team_ids = set(self._extract_team_context_candidates(block))
            if block_team_ids:
                document_team_ids.update(block_team_ids)
            if not entities and not relations:
                raw = await self._call_llm(block)
                if raw:
                    entities, relations = self._parse_response(raw, document_id)
                    llm_blocks += 1
            else:
                heuristic_blocks += 1

            self._merge_results(all_entities, all_relations, entities, relations)

            if len(document_team_ids) == 1 and entities:
                team_id = next(iter(document_team_ids))
                if team_id in all_entities:
                    for entity in entities:
                        if entity.label == "PERSON":
                            self._add_relation(
                                all_relations,
                                entity.id,
                                team_id,
                                "MEMBER_OF",
                                document_id,
                            )

        self.last_heuristic_blocks = heuristic_blocks
        self.last_llm_blocks = llm_blocks
        self.last_total_blocks = len(blocks)
        if heuristic_blocks and llm_blocks:
            self.last_extraction_mode = "mixed"
        elif llm_blocks:
            self.last_extraction_mode = "llm"
        elif heuristic_blocks:
            self.last_extraction_mode = "heuristic"
        else:
            self.last_extraction_mode = "empty"

        return list(all_entities.values()), list(all_relations.values())

    def _merge_results(
        self,
        all_entities: dict[str, Entity],
        all_relations: dict[tuple[str, str, str], Relation],
        entities: List[Entity],
        relations: List[Relation],
    ) -> None:
        for entity in entities:
            existing = all_entities.get(entity.id)
            if existing is None:
                all_entities[entity.id] = entity
                continue

            merged_doc_ids = list(dict.fromkeys(existing.source_doc_ids + entity.source_doc_ids))
            all_entities[entity.id] = Entity(
                id=existing.id,
                label=existing.label,
                name=existing.name or entity.name,
                source_doc_ids=merged_doc_ids,
            )

        for relation in relations:
            rel_key = (
                relation.source_entity_id,
                relation.target_entity_id,
                relation.relation_type,
            )
            if rel_key not in all_relations:
                all_relations[rel_key] = relation

    async def _call_llm(self, text: str) -> str:
        try:
            llm = self._get_llm()
            return await llm.generate(
                f"Extract entities and relations from:\n\n{text[:4000]}",
                system_prompt=self._system_prompt,
                max_tokens=1024,
            )
        except Exception as exc:
            logger.warning("LLMEntityExtractor: LLM call failed: %s", exc)
            return ""

    def _get_llm(self):
        if self._llm is None:
            self._llm = create_chat_llm_service(
                provider=self._graph_llm_provider,
                model=self._graph_llm_model,
                ollama_base_url=self._graph_llm_base_url,
                openai_api_key=self._graph_llm_openai_api_key,
                typhoon_api_key=self._graph_llm_typhoon_api_key,
                typhoon_base_url=self._graph_llm_typhoon_base_url,
                anthropic_api_key=self._graph_llm_anthropic_api_key,
                azure_api_key=self._graph_llm_azure_api_key,
                azure_endpoint=self._graph_llm_azure_endpoint,
                azure_deployment=self._graph_llm_azure_deployment,
            )
        return self._llm

    @staticmethod
    def _split_text(text: str) -> List[str]:
        normalized = text.replace("\r\n", "\n").strip()
        if not normalized:
            return []

        raw_blocks = [block.strip() for block in re.split(r"\n{2,}", normalized) if block.strip()]
        if not raw_blocks:
            return [normalized]

        blocks: List[str] = []
        current: List[str] = []
        current_len = 0
        max_chars = 1800

        for block in raw_blocks:
            if len(block) > max_chars:
                if current:
                    blocks.append("\n\n".join(current))
                    current = []
                    current_len = 0
                for start in range(0, len(block), max_chars):
                    blocks.append(block[start:start + max_chars])
                continue

            projected = current_len + len(block) + (2 if current else 0)
            if current and projected > max_chars:
                blocks.append("\n\n".join(current))
                current = [block]
                current_len = len(block)
            else:
                current.append(block)
                current_len = projected

        if current:
            blocks.append("\n\n".join(current))

        return blocks

    def _heuristic_extract(self, block: str, document_id: str) -> Tuple[List[Entity], List[Relation]]:
        normalized = block.replace("\r\n", "\n").strip()
        if not normalized:
            return [], []

        entities: dict[str, Entity] = {}
        relations: dict[tuple[str, str, str], Relation] = {}
        concept_ids: set[str] = set()
        person_entities_in_block: list[Entity] = []
        team_candidates: dict[str, Entity] = {}

        for line in [line.strip() for line in normalized.splitlines() if line.strip()]:
            heading_match = self._HEADING_RE.match(line)
            if heading_match:
                title = heading_match.group("title").strip()
                heading_team = self._extract_team_context(title)
                if heading_team:
                    team_entity = self._add_entity(entities, heading_team, "ORG", document_id)
                    team_candidates[team_entity.id] = team_entity
                elif title and not self._looks_like_person_heading(title):
                    self._add_entity(entities, title, "CONCEPT", document_id)
                    concept_ids.add(self._canonical_id(title))

            person_name, nickname, role = self._extract_person_facts(line)
            if person_name:
                person = self._add_entity(entities, person_name, "PERSON", document_id)
                if person not in person_entities_in_block:
                    person_entities_in_block.append(person)
                if nickname and nickname != person_name:
                    alias = self._add_entity(entities, nickname, "PERSON", document_id)
                    self._add_relation(relations, alias.id, person.id, "ALIAS_OF", document_id)

                if role:
                    role_entity = self._add_entity(entities, role, "CONCEPT", document_id)
                    self._add_relation(relations, person.id, role_entity.id, "HAS_ROLE", document_id)

                explicit_team = self._extract_team_context(line)
                if explicit_team:
                    team_entity = self._add_entity(entities, explicit_team, "ORG", document_id)
                    team_candidates[team_entity.id] = team_entity
                    self._add_relation(relations, person.id, team_entity.id, "MEMBER_OF", document_id)

            explicit_membership = self._extract_explicit_membership(line)
            if explicit_membership and all(explicit_membership):
                member_name, team_name = explicit_membership
                member = self._add_entity(entities, member_name, "PERSON", document_id)
                if member not in person_entities_in_block:
                    person_entities_in_block.append(member)
                team_entity = self._add_entity(entities, team_name, "ORG", document_id)
                team_candidates[team_entity.id] = team_entity
                self._add_relation(relations, member.id, team_entity.id, "MEMBER_OF", document_id)

            team_context = self._extract_team_context(line)
            if team_context:
                team_entity = self._add_entity(entities, team_context, "ORG", document_id)
                team_candidates[team_entity.id] = team_entity

            for concept in self._extract_uppercase_concepts(line):
                concept_entity = self._add_entity(entities, concept, "CONCEPT", document_id)
                concept_ids.add(concept_entity.id)

        if len(team_candidates) == 1 and person_entities_in_block:
            team_entity = next(iter(team_candidates.values()))
            for person in person_entities_in_block:
                self._add_relation(relations, person.id, team_entity.id, "MEMBER_OF", document_id)

        # If a block has no person-specific facts but has strong uppercase concepts,
        # still emit those nodes so the graph is queryable.
        if entities:
            return list(entities.values()), list(relations.values())
        if concept_ids:
            return list(entities.values()), list(relations.values())
        return [], []

    def _extract_person_facts(self, line: str) -> tuple[str | None, str | None, str | None]:
        """Extract a canonical person name, nickname, and role from one line."""
        # Pattern 1: "ลัทธพล ชื่อเล่น เอก (Email: ...) ทำหน้าที่เป็น Manager ..."
        m = self._NICKNAME_LINE_RE.match(line)
        if m:
            name = m.group("name").strip()
            nickname = m.group("nickname").strip()
            role = self._extract_role(line)
            return name or None, nickname or None, role

        # Pattern 2: section-style headings like "ลัทธพล (เอก) - Manager / ABAP Technical Lead"
        if " - " in line and not line.startswith("#"):
            left, right = line.split(" - ", 1)
            name, nickname = self._extract_name_and_nickname(left)
            role = right.strip() or None
            if name:
                return name, nickname, role

        # Pattern 3: plain sentence with "เป็น ..."
        if "ชื่อเล่น" in line or "เป็น" in line or "ทำหน้าที่เป็น" in line:
            name, nickname = self._extract_name_and_nickname(line)
            role = self._extract_role(line)
            if name:
                return name, nickname, role

        return None, None, None

    def _extract_name_and_nickname(self, text: str) -> tuple[str | None, str | None]:
        cleaned = text.strip()
        if not cleaned:
            return None, None

        if "ชื่อเล่น" in cleaned:
            parts = cleaned.split("ชื่อเล่น", 1)
            name = parts[0].strip()
            nickname_part = parts[1].strip()
            nickname = re.split(r"\s*\(Email:|\s+ทำหน้าที่เป็น|\s+เป็น|\s+-\s+", nickname_part, 1)[0].strip()
            return self._normalize_name(name), self._normalize_name(nickname)

        if "(" in cleaned and ")" in cleaned:
            prefix = cleaned.split("-", 1)[0].strip()
            m = self._HEADING_PERSON_RE.match(prefix)
            if m:
                name = self._normalize_name(m.group("name"))
                nickname = self._normalize_name(m.group("nickname")) if m.group("nickname") else None
                return name, nickname

        # Fallback: use the first few tokens if it looks like a profile line.
        tokens = cleaned.split()
        if len(tokens) >= 2 and self._looks_like_person_line(cleaned):
            name = self._normalize_name(" ".join(tokens[:2]))
            return name, None

        return None, None

    def _extract_role(self, text: str) -> str | None:
        for marker in ("ทำหน้าที่เป็น", "มีบทบาทหลักในการ", "รับผิดชอบ", "เหมาะกับ", "เป็น"):
            if marker not in text:
                continue
            tail = text.split(marker, 1)[1].strip()
            tail = re.split(r"\s+(?:โดย|และ|,|นอกจากนี้|เมื่อ|ในกรณี|ซึ่ง|ถ้า)", tail, 1)[0].strip()
            tail = tail.rstrip("。.")
            if tail:
                return tail
        return None

    def _extract_team_context(self, text: str) -> str | None:
        match = self._TEAM_CONTEXT_RE.search(text)
        if not match:
            return None
        return self._trim_team_name(match.group("team"))

    def _extract_team_context_candidates(self, text: str) -> List[str]:
        candidates: List[str] = []
        for line in [line.strip() for line in text.replace("\r\n", "\n").splitlines() if line.strip()]:
            team = self._extract_team_context(line)
            if team:
                canonical = self._canonical_id(team)
                if canonical not in candidates:
                    candidates.append(canonical)
        return candidates

    def _extract_explicit_membership(self, text: str) -> tuple[str | None, str | None]:
        membership_match = self._TEAM_MEMBER_RE.search(text)
        if membership_match:
            person = self._normalize_name(membership_match.group("person"))
            team = self._trim_team_name(membership_match.group("team"))
            if person and team:
                return person, team

        if not any(marker in text for marker in ("เป็นสมาชิก", "อยู่ใน", "ทำงานใน", "สังกัด")):
            return None, None

        person = None
        for marker in ("เป็นสมาชิก", "อยู่ใน", "ทำงานใน", "สังกัด"):
            if marker not in text:
                continue
            left = text.split(marker, 1)[0].strip(" -:—–\t")
            person, _ = self._extract_name_and_nickname(left)
            if person:
                break
        if not person:
            person, _ = self._extract_name_and_nickname(text)
        if not person:
            return None, None

        team = self._extract_team_context(text)
        if not team:
            return None, None

        return person, team

    def _trim_team_name(self, value: str) -> str | None:
        cleaned = re.sub(r"\s+", " ", value.strip())
        if not cleaned:
            return None
        stop_match = self._TEAM_STOP_RE.search(cleaned)
        if stop_match:
            cleaned = cleaned[: stop_match.start()].strip()
        cleaned = cleaned.rstrip("：:,-–—")
        return cleaned or None

    def _extract_uppercase_concepts(self, line: str) -> List[str]:
        concepts: List[str] = []
        tokens = []
        tokens.extend(re.findall(r"\b[A-Z]{2,}\b", line))
        tokens.extend(self._UPPER_CONCEPT_RE.findall(line))
        for token in tokens:
            if len(token) < 2:
                continue
            # Avoid capturing markdown markers and noisy punctuation.
            if token in {"HTTP", "HTTPS"}:
                continue
            concepts.append(token)
        return list(dict.fromkeys(concepts))

    def _add_entity(
        self,
        entities: dict[str, Entity],
        name: str,
        label: str,
        document_id: str,
    ) -> Entity:
        canonical = self._canonical_id(name)
        existing = entities.get(canonical)
        if existing is not None:
            if document_id not in existing.source_doc_ids:
                existing.source_doc_ids.append(document_id)
            if not existing.name:
                existing.name = name.strip()
            return existing

        entity = Entity(
            id=canonical,
            label=label,
            name=name.strip(),
            source_doc_ids=[document_id],
        )
        entities[canonical] = entity
        return entity

    def _add_relation(
        self,
        relations: dict[tuple[str, str, str], Relation],
        source_id: str,
        target_id: str,
        relation_type: str,
        document_id: str,
    ) -> None:
        if not source_id or not target_id or source_id == target_id:
            return
        rel_type = self._normalize_relation_type(relation_type)
        key = (source_id, target_id, rel_type)
        if key in relations:
            return
        relations[key] = Relation(
            id=str(uuid.uuid4()),
            source_entity_id=source_id,
            target_entity_id=target_id,
            relation_type=rel_type,
            source_doc_id=document_id,
        )

    @staticmethod
    def _canonical_id(value: str) -> str:
        return re.sub(r"\s+", " ", value.strip()).lower()

    @staticmethod
    def _normalize_name(value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = re.sub(r"\s+", " ", value.strip())
        return cleaned or None

    @staticmethod
    def _normalize_relation_type(value: str) -> str:
        rel_type = value.upper().replace(" ", "_")
        return _RELATION_NORMALIZATION.get(rel_type, rel_type)

    @staticmethod
    def _looks_like_person_heading(text: str) -> bool:
        cleaned = text.strip()
        return (
            bool(re.search(r"\s*\([^)]{1,40}\)\s*$", cleaned))
            or " - " in cleaned
            or "ชื่อเล่น" in cleaned
        )

    @staticmethod
    def _looks_like_person_line(text: str) -> bool:
        # Lines that mention "ชื่อเล่น" or an explicit role verb are likely profile lines.
        return any(marker in text for marker in ("ชื่อเล่น", "ทำหน้าที่เป็น", "เป็น "))

    def _parse_response(
        self, raw: str, document_id: str
    ) -> Tuple[List[Entity], List[Relation]]:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start == -1 or end == 0:
                logger.warning("LLMEntityExtractor: could not parse JSON from LLM output")
                return [], []
            try:
                data = json.loads(raw[start:end])
            except json.JSONDecodeError:
                logger.warning("LLMEntityExtractor: malformed JSON in LLM output")
                return [], []

        entities: List[Entity] = []
        entity_ids: set[str] = set()

        for e in data.get("entities", []):
            eid = str(e.get("id", "")).strip().lower()
            label = str(e.get("label", "CONCEPT")).upper()
            name = str(e.get("name", eid)).strip()
            if not eid:
                continue
            if label not in {"PERSON", "ORG", "LOCATION", "CONCEPT"}:
                label = "CONCEPT"
            entities.append(Entity(id=eid, label=label, name=name, source_doc_ids=[document_id]))
            entity_ids.add(eid)

        relations: List[Relation] = []
        for r in data.get("relations", []):
            src = str(r.get("source", "")).strip().lower()
            tgt = str(r.get("target", "")).strip().lower()
            rel_type = self._normalize_relation_type(str(r.get("type", "RELATED_TO")))
            if src not in entity_ids or tgt not in entity_ids or src == tgt:
                continue
            relations.append(Relation(
                id=str(uuid.uuid4()),
                source_entity_id=src,
                target_entity_id=tgt,
                relation_type=rel_type,
                source_doc_id=document_id,
            ))

        return entities, relations
