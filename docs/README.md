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

Reading the flow from top to bottom helps connect the docs to the codebase:

1. `Environment` shows what the system needs to start
2. `Requirement` shows what the system is supposed to do
3. `Design` shows how the services and layers are split
4. `Task` shows where the behavior lives in code

## English docs

- [Environment](environment.md)
- [Requirement](requirement.md)
- [Design](design.md)
- [Task](task.md)

## Thai supplemental docs

- [Thai docs index](th/README.md)
- [Environment - Thai](th/environment.md)
- [Requirement - Thai](th/requirement.md)
- [Design - Thai](th/design.md)
- [Task - Thai](th/task.md)

## Notes

- The English documents are the primary reference for the repository.
- The Thai files are supplementary copies for convenience.
- Start with `Environment`, then move to `Requirement`, `Design`, and `Task`.
