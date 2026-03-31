import logging
import asyncio
from collections import defaultdict, deque
from typing import List

from neo4j import AsyncGraphDatabase, AsyncDriver
from neo4j.exceptions import ServiceUnavailable

from application.ports.i_graph_repository import IGraphRepository
from domain.entities import Entity, Relation, GraphQueryResult
from domain.errors import GraphServiceUnavailableError

logger = logging.getLogger(__name__)
_MAX_RETRIES = 3
_BACKOFF_BASE = 2.0
_RELATION_PRIORITY = {
    "MEMBER_OF": 100,
    "PART_OF": 95,
    "HAS_ROLE": 80,
    "REPORTS_TO": 75,
    "WORKS_WITH": 60,
    "RESPONSIBLE_FOR": 55,
    "GOOD_FOR": 40,
    "ALIAS_OF": 20,
    "MENTIONS": 5,
}


class Neo4jGraphRepository(IGraphRepository):
    """Neo4j implementation of IGraphRepository."""

    def __init__(self, uri: str, user: str, password: str):
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(
            uri, auth=(user, password)
        )

    async def close(self) -> None:
        await self._driver.close()

    async def _retry(self, operation_name: str, call):
        last_error: Exception = RuntimeError("No attempts made")
        for attempt in range(_MAX_RETRIES):
            try:
                return await call()
            except ServiceUnavailable as exc:
                last_error = exc
                wait = _BACKOFF_BASE ** attempt
                logger.warning(
                    "Neo4j %s attempt %d failed: %s — retrying in %.1fs",
                    operation_name,
                    attempt + 1,
                    exc,
                    wait,
                )
                await asyncio.sleep(wait)
        raise GraphServiceUnavailableError(str(last_error)) from last_error

    # ------------------------------------------------------------------
    # store_entities_and_relations
    # ------------------------------------------------------------------

    async def store_entities_and_relations(
        self,
        entities: List[Entity],
        relations: List[Relation],
        namespace: str = "default",
    ) -> None:
        async def _call():
            async with self._driver.session() as session:
                await session.execute_write(
                    self._upsert_entities_tx, entities, namespace
                )
                await session.execute_write(
                    self._upsert_relations_tx, relations, namespace
                )
        await self._retry("store_entities_and_relations", _call)

    @staticmethod
    async def _upsert_entities_tx(tx, entities: List[Entity], namespace: str):
        for entity in entities:
            await tx.run(
                """
                MERGE (e:Entity {id: $id, namespace: $namespace})
                ON CREATE SET e.label = $label, e.name = $name,
                              e.source_doc_ids = $source_doc_ids
                ON MATCH SET  e.label = $label, e.name = $name,
                              e.source_doc_ids = [x IN e.source_doc_ids
                                                  WHERE NOT x IN $source_doc_ids]
                                                 + $source_doc_ids
                """,
                id=entity.id,
                namespace=namespace,
                label=entity.label,
                name=entity.name,
                source_doc_ids=entity.source_doc_ids,
            )

    @staticmethod
    async def _upsert_relations_tx(tx, relations: List[Relation], namespace: str):
        for rel in relations:
            await tx.run(
                """
                MATCH (src:Entity {id: $src_id, namespace: $namespace})
                MATCH (tgt:Entity {id: $tgt_id, namespace: $namespace})
                MERGE (src)-[r:RELATION {
                    relation_type: $rel_type,
                    source_doc_id: $doc_id,
                    namespace: $namespace
                }]->(tgt)
                ON CREATE SET r.id = $rel_id
                """,
                src_id=rel.source_entity_id,
                tgt_id=rel.target_entity_id,
                rel_type=rel.relation_type,
                doc_id=rel.source_doc_id,
                namespace=namespace,
                rel_id=rel.id,
            )

    # ------------------------------------------------------------------
    # query_related_entities
    # ------------------------------------------------------------------

    async def query_related_entities(
        self,
        entity_names: List[str],
        max_hops: int = 2,
        namespace: str = "default",
    ) -> GraphQueryResult:
        async def _call():
            async with self._driver.session() as session:
                result = await session.execute_read(
                    self._query_tx, entity_names, max_hops, namespace
                )
            return result
        return await self._retry("query_related_entities", _call)

    @staticmethod
    async def _query_tx(tx, entity_names: List[str], max_hops: int, namespace: str):
        canonical_names = [n.lower() for n in entity_names]

        # Step 1: find all nodes reachable within max_hops via RELATION edges
        node_records = await tx.run(
            f"""
            MATCH (start:Entity)
            WHERE start.id IN $ids AND start.namespace = $namespace
            MATCH (start)-[:RELATION*0..{max_hops}]-(connected:Entity)
            WHERE connected.namespace = $namespace
            RETURN DISTINCT connected AS n
            """,
            ids=canonical_names,
            namespace=namespace,
        )
        seen_entities: set = set()
        seen_ids: List[str] = []
        entities: List[Entity] = []
        async for record in node_records:
            node = record["n"]
            if node["id"] not in seen_entities:
                seen_entities.add(node["id"])
                seen_ids.append(node["id"])
                entities.append(Entity(
                    id=node["id"],
                    label=node.get("label", "CONCEPT"),
                    name=node.get("name", node["id"]),
                    source_doc_ids=list(node.get("source_doc_ids", [])),
                ))

        # Step 2: fetch all relations between those nodes
        relations: List[Relation] = []
        seen_relations: set = set()
        if len(seen_ids) > 1:
            rel_records = await tx.run(
                """
                MATCH (a:Entity)-[r:RELATION]->(b:Entity)
                WHERE a.namespace = $namespace AND b.namespace = $namespace
                  AND a.id IN $ids AND b.id IN $ids
                RETURN r, a.id AS src, b.id AS tgt
                """,
                namespace=namespace,
                ids=seen_ids,
            )
            async for record in rel_records:
                rel = record["r"]
                rel_key = (record["src"], record["tgt"], rel["relation_type"])
                if rel_key not in seen_relations:
                    seen_relations.add(rel_key)
                    relations.append(Relation(
                        id=rel.get("id", ""),
                        source_entity_id=record["src"],
                        target_entity_id=record["tgt"],
                        relation_type=rel["relation_type"],
                        source_doc_id=rel.get("source_doc_id", ""),
                    ))

        entities = Neo4jGraphRepository._rank_entities(entities, relations, seed_ids=seen_ids)
        relations = Neo4jGraphRepository._rank_relations(relations, seed_ids=seen_ids)

        context_text = _build_context_text(entities, relations)
        return GraphQueryResult(
            entities=entities, relations=relations, context_text=context_text
        )

    # ------------------------------------------------------------------
    # search_entities_by_text  (substring fallback)
    # ------------------------------------------------------------------

    async def search_entities_by_text(
        self,
        query_text: str,
        max_hops: int = 2,
        namespace: str = "default",
    ) -> GraphQueryResult:
        """Find entities whose id or name contains any word from query_text, then traverse."""
        async def _call():
            async with self._driver.session() as session:
                result = await session.execute_read(
                    self._search_tx, query_text, max_hops, namespace
                )
            return result
        return await self._retry("search_entities_by_text", _call)

    @staticmethod
    async def _search_tx(tx, query_text: str, max_hops: int, namespace: str):
        # Build lowercase words (min 3 chars) to CONTAINS-match against entity id/name
        words = [w.lower() for w in query_text.split() if len(w) >= 3]
        if not words:
            words = [query_text.lower()]

        # Step 1: find seed entities matching any word
        seed_records = await tx.run(
            """
            MATCH (e:Entity)
            WHERE e.namespace = $namespace
              AND ANY(word IN $words WHERE toLower(e.id) CONTAINS word
                                       OR toLower(e.name) CONTAINS word)
            RETURN e
            """,
            namespace=namespace,
            words=words,
        )
        seed_ids: List[str] = []
        async for record in seed_records:
            seed_ids.append(record["e"]["id"])

        if not seed_ids:
            return GraphQueryResult(entities=[], relations=[], context_text="")

        # Step 2: traverse from seeds using pure Cypher (no APOC)
        node_records = await tx.run(
            f"""
            MATCH (start:Entity)
            WHERE start.id IN $ids AND start.namespace = $namespace
            MATCH (start)-[:RELATION*0..{max_hops}]-(connected:Entity)
            WHERE connected.namespace = $namespace
            RETURN DISTINCT connected AS n
            """,
            ids=seed_ids,
            namespace=namespace,
        )
        seen_entities: set = set()
        all_ids: List[str] = []
        entities: List[Entity] = []
        async for record in node_records:
            node = record["n"]
            if node["id"] not in seen_entities:
                seen_entities.add(node["id"])
                all_ids.append(node["id"])
                entities.append(Entity(
                    id=node["id"],
                    label=node.get("label", "CONCEPT"),
                    name=node.get("name", node["id"]),
                    source_doc_ids=list(node.get("source_doc_ids", [])),
                ))

        # If traversal returned nothing, at least return the seed entities themselves
        if not entities:
            fallback = await tx.run(
                "MATCH (e:Entity) WHERE e.id IN $ids AND e.namespace = $namespace RETURN e",
                ids=seed_ids, namespace=namespace,
            )
            async for record in fallback:
                node = record["e"]
                if node["id"] not in seen_entities:
                    seen_entities.add(node["id"])
                    all_ids.append(node["id"])
                    entities.append(Entity(
                        id=node["id"],
                        label=node.get("label", "CONCEPT"),
                        name=node.get("name", node["id"]),
                        source_doc_ids=list(node.get("source_doc_ids", [])),
                    ))

        # Step 3: fetch relations between discovered nodes
        relations: List[Relation] = []
        seen_relations: set = set()
        if len(all_ids) > 1:
            rel_records = await tx.run(
                """
                MATCH (a:Entity)-[r:RELATION]->(b:Entity)
                WHERE a.namespace = $namespace AND b.namespace = $namespace
                  AND a.id IN $ids AND b.id IN $ids
                RETURN r, a.id AS src, b.id AS tgt
                """,
                namespace=namespace,
                ids=all_ids,
            )
            async for record in rel_records:
                rel = record["r"]
                rel_key = (record["src"], record["tgt"], rel["relation_type"])
                if rel_key not in seen_relations:
                    seen_relations.add(rel_key)
                    relations.append(Relation(
                        id=rel.get("id", ""),
                        source_entity_id=record["src"],
                        target_entity_id=record["tgt"],
                        relation_type=rel["relation_type"],
                        source_doc_id=rel.get("source_doc_id", ""),
                    ))

        entities = Neo4jGraphRepository._rank_entities(entities, relations, seed_ids=seed_ids)
        relations = Neo4jGraphRepository._rank_relations(relations, seed_ids=seed_ids)

        context_text = _build_context_text(entities, relations)
        return GraphQueryResult(entities=entities, relations=relations, context_text=context_text)

    # ------------------------------------------------------------------
    # delete_by_document_id
    # ------------------------------------------------------------------

    async def delete_by_document_id(self, document_id: str, namespace: str = "default") -> None:
        try:
            async with self._driver.session() as session:
                await session.execute_write(self._delete_doc_tx, document_id, namespace)
        except ServiceUnavailable as exc:
            raise GraphServiceUnavailableError(str(exc)) from exc

    @staticmethod
    async def _delete_doc_tx(tx, document_id: str, namespace: str):
        # Delete relations sourced from this document
        await tx.run(
            """
            MATCH ()-[r:RELATION {source_doc_id: $doc_id, namespace: $namespace}]->()
            DELETE r
            """,
            doc_id=document_id,
            namespace=namespace,
        )
        # Remove document from entity source lists; delete orphan entities
        await tx.run(
            """
            MATCH (e:Entity)
            WHERE e.namespace = $namespace AND $doc_id IN e.source_doc_ids
            SET e.source_doc_ids = [x IN e.source_doc_ids WHERE x <> $doc_id]
            WITH e WHERE size(e.source_doc_ids) = 0
            DETACH DELETE e
            """,
            doc_id=document_id,
            namespace=namespace,
        )

    # ------------------------------------------------------------------
    # delete_by_namespace
    # ------------------------------------------------------------------

    _DELETE_BATCH_SIZE = 1000

    async def delete_by_namespace(self, namespace: str) -> dict:
        """Delete all entities and relations for a namespace in batches to avoid timeouts."""
        try:
            async with self._driver.session() as session:
                # Count before deletion
                count_result = await session.run(
                    "MATCH (e:Entity {namespace: $ns}) RETURN count(e) AS cnt",
                    ns=namespace,
                )
                count_record = await count_result.single()
                entity_count = count_record["cnt"] if count_record else 0

                # Delete relations in one pass (relations are lighter)
                await session.execute_write(self._delete_relations_tx, namespace)

                # Delete entities in batches
                deleted = 0
                while True:
                    batch_deleted = await session.execute_write(
                        self._delete_entities_batch_tx, namespace, self._DELETE_BATCH_SIZE
                    )
                    deleted += batch_deleted
                    if batch_deleted < self._DELETE_BATCH_SIZE:
                        break

            return {"deleted_entities": entity_count}
        except ServiceUnavailable as exc:
            raise GraphServiceUnavailableError(str(exc)) from exc

    @staticmethod
    async def _delete_relations_tx(tx, namespace: str) -> None:
        await tx.run(
            "MATCH ()-[r:RELATION {namespace: $ns}]->() DELETE r",
            ns=namespace,
        )

    @staticmethod
    async def _delete_entities_batch_tx(tx, namespace: str, batch_size: int) -> int:
        result = await tx.run(
            """
            MATCH (e:Entity {namespace: $ns})
            WITH e LIMIT $batch
            DETACH DELETE e
            RETURN count(*) AS deleted
            """,
            ns=namespace,
            batch=batch_size,
        )
        record = await result.single()
        return record["deleted"] if record else 0

    # ------------------------------------------------------------------
    # get_stats
    # ------------------------------------------------------------------

    async def list_namespaces(self) -> list:
        """Return per-namespace entity and relation counts."""
        try:
            async with self._driver.session() as session:
                entity_result = await session.run(
                    "MATCH (e:Entity) RETURN e.namespace AS namespace, count(e) AS entity_count"
                )
                entity_rows = {r["namespace"]: r["entity_count"] async for r in entity_result}

                rel_result = await session.run(
                    "MATCH ()-[r:RELATION]->() RETURN r.namespace AS namespace, count(r) AS relation_count"
                )
                rel_rows = {r["namespace"]: r["relation_count"] async for r in rel_result}

                all_ns = set(entity_rows) | set(rel_rows)
                return [
                    {
                        "namespace": ns,
                        "entity_count": entity_rows.get(ns, 0),
                        "relation_count": rel_rows.get(ns, 0),
                    }
                    for ns in sorted(all_ns)
                ]
        except ServiceUnavailable as exc:
            raise GraphServiceUnavailableError(str(exc)) from exc

    async def get_stats(self) -> dict:
        try:
            async with self._driver.session() as session:
                result = await session.run(
                    """
                    MATCH (e:Entity) WITH count(e) AS entity_count
                    MATCH ()-[r:RELATION]->() WITH entity_count, count(r) AS relation_count
                    RETURN entity_count, relation_count
                    """
                )
                record = await result.single()
                if record:
                    return {
                        "entity_count": record["entity_count"],
                        "relation_count": record["relation_count"],
                    }
                return {"entity_count": 0, "relation_count": 0}
        except ServiceUnavailable as exc:
            raise GraphServiceUnavailableError(str(exc)) from exc

    # ------------------------------------------------------------------
    # Ranking helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _relation_priority(relation_type: str) -> int:
        return _RELATION_PRIORITY.get((relation_type or "").upper(), 0)

    @classmethod
    def _rank_entities(
        cls,
        entities: List[Entity],
        relations: List[Relation],
        seed_ids: List[str],
    ) -> List[Entity]:
        if not entities:
            return []

        seed_set = {s for s in seed_ids if s}
        adjacency: dict[str, set[str]] = defaultdict(set)
        for rel in relations:
            adjacency[rel.source_entity_id].add(rel.target_entity_id)
            adjacency[rel.target_entity_id].add(rel.source_entity_id)

        distances: dict[str, int] = {seed: 0 for seed in seed_set}
        queue = deque(seed_set)
        while queue:
            current = queue.popleft()
            for neighbor in adjacency.get(current, set()):
                if neighbor not in distances:
                    distances[neighbor] = distances[current] + 1
                    queue.append(neighbor)

        direct_bonus: dict[str, int] = defaultdict(int)
        relation_bonus: dict[str, int] = defaultdict(int)
        for rel in relations:
            weight = cls._relation_priority(rel.relation_type)
            if rel.source_entity_id in seed_set and rel.target_entity_id not in seed_set:
                direct_bonus[rel.target_entity_id] = max(direct_bonus[rel.target_entity_id], weight)
            if rel.target_entity_id in seed_set and rel.source_entity_id not in seed_set:
                direct_bonus[rel.source_entity_id] = max(direct_bonus[rel.source_entity_id], weight)
            relation_bonus[rel.source_entity_id] = max(relation_bonus[rel.source_entity_id], weight)
            relation_bonus[rel.target_entity_id] = max(relation_bonus[rel.target_entity_id], weight)

        def _score(entity: Entity) -> tuple:
            is_seed = 1 if entity.id in seed_set else 0
            hop = distances.get(entity.id, 99)
            direct = direct_bonus.get(entity.id, 0)
            relation = relation_bonus.get(entity.id, 0)
            return (
                -is_seed,
                hop,
                -direct,
                -relation,
                entity.name.lower(),
                entity.id,
            )

        return sorted(entities, key=_score)

    @classmethod
    def _rank_relations(cls, relations: List[Relation], seed_ids: List[str]) -> List[Relation]:
        if not relations:
            return []
        seed_set = {s for s in seed_ids if s}

        def _score(rel: Relation) -> tuple:
            touches_seed = rel.source_entity_id in seed_set or rel.target_entity_id in seed_set
            return (
                0 if touches_seed else 1,
                -cls._relation_priority(rel.relation_type),
                rel.source_entity_id,
                rel.target_entity_id,
                rel.relation_type,
                rel.id,
            )

        return sorted(relations, key=_score)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _build_context_text(entities: List[Entity], relations: List[Relation]) -> str:
    if not entities:
        return ""
    lines = ["### Knowledge Graph Context"]
    entity_map = {e.id: e.name for e in entities}
    for rel in relations:
        src = entity_map.get(rel.source_entity_id, rel.source_entity_id)
        tgt = entity_map.get(rel.target_entity_id, rel.target_entity_id)
        lines.append(f"- {src} --[{rel.relation_type}]--> {tgt}")
    return "\n".join(lines)
