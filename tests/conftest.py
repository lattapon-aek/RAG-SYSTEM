"""
conftest.py — base path setup for rag-system tests

Tests in this directory target the RAG service (core/rag-service).
Tests for other services live in their own service directories.
Each test file manages its own sys.path via module-level inserts.
"""
import sys
import os

# Ensure RAG service is on path first for all tests in this directory
_RAG = os.path.abspath(os.path.join(os.path.dirname(__file__), "../core/rag-service"))
if _RAG not in sys.path:
    sys.path.insert(0, _RAG)

# Exclude test files that belong to other services (they have their own test dirs)
collect_ignore = [
    "test_ingest_use_case.py",
    "test_spacy_extractor.py",
    "test_intelligence_service.py",
    # These tests have their own service-specific sys.path setup and must be
    # run from their respective service directories to avoid module conflicts:
    "test_graph_service.py",
    "test_knowledge_connector.py",
    # Integration tests require docker-compose up:
    "test_integration.py",
]
