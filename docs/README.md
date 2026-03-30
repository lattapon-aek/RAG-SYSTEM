# Documentation

This folder contains the project documentation in English, with Thai supplemental copies under `docs/th/`.

This repository is intended as a learning resource for understanding how a RAG system is organized, wired, and operated.

Return to the main project page: [README](../README.md)

## What to read first

| Stage | Read this | Why |
|---|---|---|
| 1 | [Environment](environment.md) | See the minimum variables needed to boot the stack |
| 2 | [Requirement](requirement.md) | Understand what the system is expected to do |
| 3 | [Design](design.md) | Understand how the system is structured |
| 4 | [Task](task.md) | See the concrete implementation work in the repo |

## System Flow

```text
User / operator
  -> Dashboard or MCP server
  -> Service entrypoint
  -> API router and dependency wiring
  -> Application use case
  -> Infrastructure adapter
  -> Database / vector store / graph store / queue
  -> Response back to the caller
```

```mermaid
flowchart LR
    U[User / operator] --> D[Dashboard]
    U --> M[MCP server]
    D --> I1[Ingestion service]
    D --> Q[RAG service]
    M --> Q
    I1 --> Q
    I1 --> RQ[Redis queue]
    RQ --> W[Ingestion worker]
    Q --> P[Parser / chunker / embedding]
    Q --> G[Graph service]
    Q --> RR[Reranker service]
    P --> C[ChromaDB]
    P --> PG[PostgreSQL]
    G --> N[Neo4j]
    RR --> Q
    C --> Q
    PG --> Q
    N --> Q
    Q --> O[Answer / result]
```

## Service Map

This diagram shows the main services and the data they own so you can connect the docs to the runtime boundaries:

```mermaid
flowchart TB
    U[User / operator] --> D[Dashboard]
    U --> M[MCP server]

    D --> I[Ingestion service]
    D --> R[RAG service]
    D --> G[Graph service]
    D --> X[Intelligence service]

    M --> I
    M --> R
    M --> G
    M --> X

    I --> Q[Redis queue]
    I --> P[Parser / chunker / embedding]
    I --> V[Vector store]
    I --> S[Document metadata and versioning]
    I --> GS[Graph sync]

    R --> C[Cache / memory / retrieval]
    R --> RR[Reranker service]
    R --> V
    R --> N[Neo4j]
    R --> L[LLM / model provider]

    G --> N
    X --> A[Analysis / expiry / feedback jobs]

    Q --> W[Ingestion worker]
    W --> P
    W --> V
    W --> S
    W --> GS

    V --> R
    N --> R
    RR --> R
    C --> R
    L --> R
```

Reading the flow from top to bottom helps connect the docs to the codebase:

1. `Environment` shows what the system needs to start
2. `Requirement` shows what the system is supposed to do
3. `Design` shows how the services and layers are split
4. `Task` shows where the behavior lives in code
5. `Ingestion walkthrough` shows how a document becomes searchable
6. `Query walkthrough` shows how a question becomes an answer

## Reading Graph

```mermaid
flowchart TB
    E[Environment] --> R[Requirement]
    R --> D[Design]
    D --> T[Task]
    T --> IW[Ingestion walkthrough]
    T --> QW[Query walkthrough]
    E --> SM[Service Map]
    R --> RM[Requirement-to-walkthrough map]
    D --> DM[Design-to-walkthrough map]
```

This is the recommended order for first-time readers:

1. Start with `Environment` to see how the stack boots
2. Read `Requirement` to understand what the system must do
3. Read `Design` to understand how the system is split
4. Read `Task` to connect the architecture to the actual code
5. Read the walkthroughs to follow concrete request flows

## Walkthroughs

Use these pages when you want to follow a request step by step through the actual code path:

- [Ingestion walkthrough](ingestion-walkthrough.md)
- [Query walkthrough](query-walkthrough.md)

## 10-Minute Reading Plan

If you want a fast walkthrough, spend about 10 minutes in this order:

1. `README.md` in the project root to get the big picture
2. `docs/README.md` to understand the learning path
3. `docs/environment.md` to see how the stack boots
4. `docs/requirement.md` to learn the system goals
5. `docs/design.md` to understand the architecture
6. `docs/task.md` to connect the docs back to source code
7. `ingestion/ingestion-service/interface/routers.py` to see the ingestion API flow
8. `core/rag-service/interface/routers.py` to see the query flow
9. `core/graph-service/interface/routers.py` and `intelligence/intelligence-service/main.py` for the graph and background-job parts
10. `platform/dashboard/src/app/*` and `platform/mcp-server/src/*` to see how humans and tools interact with the system

## English docs

- [Environment](environment.md)
- [Requirement](requirement.md)
- [Design](design.md)
- [Task](task.md)
- [Ingestion walkthrough](ingestion-walkthrough.md)
- [Query walkthrough](query-walkthrough.md)

## Thai supplemental docs

- [Thai docs index](th/README.md)
- [Environment - Thai](th/environment.md)
- [Requirement - Thai](th/requirement.md)
- [Design - Thai](th/design.md)
- [Task - Thai](th/task.md)
- [Ingestion walkthrough - Thai](th/ingestion-walkthrough.md)
- [Query walkthrough - Thai](th/query-walkthrough.md)

## Notes

- The English documents are the primary reference for the repository.
- The Thai files are supplementary copies for convenience.
- Start with `Environment`, then move to `Requirement`, `Design`, and `Task`.
