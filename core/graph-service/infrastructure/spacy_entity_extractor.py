import logging
import uuid
from typing import List, Tuple

import spacy
from spacy.tokens import Doc

from application.ports.i_entity_extractor import IEntityExtractor
from domain.entities import Entity, Relation
from domain.errors import EntityExtractionError

logger = logging.getLogger(__name__)

# spaCy label → canonical label mapping
_LABEL_MAP = {
    "PERSON": "PERSON",
    "PER": "PERSON",
    "ORG": "ORG",
    "GPE": "LOCATION",
    "LOC": "LOCATION",
    "FAC": "LOCATION",
    "PRODUCT": "CONCEPT",
    "EVENT": "CONCEPT",
    "WORK_OF_ART": "CONCEPT",
    "LAW": "CONCEPT",
    "LANGUAGE": "CONCEPT",
    "NORP": "CONCEPT",
}

# Dependency arc pairs that indicate a relation
_RELATION_DEPS = {"nsubj", "nsubjpass", "dobj", "pobj", "attr"}


class SpacyEntityExtractor(IEntityExtractor):
    """Default entity extractor using spaCy NER + dependency parsing."""

    def __init__(self, model_name: str = "en_core_web_sm"):
        try:
            self._nlp = spacy.load(model_name)
        except OSError as exc:
            raise EntityExtractionError(
                f"spaCy model '{model_name}' not found. "
                f"Run: python -m spacy download {model_name}"
            ) from exc

    async def extract(
        self, text: str, document_id: str
    ) -> Tuple[List[Entity], List[Relation]]:
        try:
            doc: Doc = self._nlp(text)
        except Exception as exc:
            raise EntityExtractionError(str(exc)) from exc

        entities = self._extract_entities(doc, document_id)
        # Build a token-index → Entity map so multi-word spans resolve correctly
        token_entity_index: dict[int, "Entity"] = {}
        for ent_span in doc.ents:
            label = _LABEL_MAP.get(ent_span.label_)
            if label is None:
                continue
            canonical = ent_span.text.strip().lower()
            entity = next((e for e in entities if e.id == canonical), None)
            if entity:
                for tok in ent_span:
                    token_entity_index[tok.i] = entity
        relations = self._extract_relations(doc, document_id, token_entity_index)
        return entities, relations

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _extract_entities(self, doc: Doc, document_id: str) -> List[Entity]:
        seen: dict[str, Entity] = {}
        for ent in doc.ents:
            label = _LABEL_MAP.get(ent.label_)
            if label is None:
                continue
            canonical = ent.text.strip().lower()
            if canonical in seen:
                if document_id not in seen[canonical].source_doc_ids:
                    seen[canonical].source_doc_ids.append(document_id)
            else:
                seen[canonical] = Entity(
                    id=canonical,
                    label=label,
                    name=ent.text.strip(),
                    source_doc_ids=[document_id],
                )
        return list(seen.values())

    def _extract_relations(
        self,
        doc: Doc,
        document_id: str,
        token_entity_index: dict,
    ) -> List[Relation]:
        """
        Use verbs as pivots: for each verb collect its subject entities and
        object entities, then create subject→VERB_LEMMA→object relations.
        """
        relations: List[Relation] = []
        seen: set = set()

        _SUBJ_DEPS = {"nsubj", "nsubjpass"}
        _OBJ_DEPS  = {"dobj", "pobj", "attr"}

        for token in doc:
            if token.pos_ not in {"VERB", "AUX"}:
                continue
            # Collect entities that are subjects/objects of this verb
            subj_ents = []
            obj_ents  = []
            for child in token.children:
                ent = token_entity_index.get(child.i)
                if not ent:
                    # For prepositional objects, look one level deeper (prep → pobj)
                    if child.dep_ == "prep":
                        for gc in child.children:
                            ent2 = token_entity_index.get(gc.i)
                            if ent2:
                                obj_ents.append((ent2, gc.dep_))
                    continue
                if child.dep_ in _SUBJ_DEPS:
                    subj_ents.append(ent)
                elif child.dep_ in _OBJ_DEPS:
                    obj_ents.append((ent, child.dep_))

            # Cross-product: every subject × every object
            verb_label = token.lemma_.upper()
            for src in subj_ents:
                for tgt, dep in obj_ents:
                    if src.id == tgt.id:
                        continue
                    key = (src.id, tgt.id, verb_label)
                    if key not in seen:
                        seen.add(key)
                        relations.append(Relation(
                            id=str(uuid.uuid4()),
                            source_entity_id=src.id,
                            target_entity_id=tgt.id,
                            relation_type=verb_label,
                            source_doc_id=document_id,
                        ))
        return relations
