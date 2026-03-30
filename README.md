# RAG System

## English

Microservices-based Retrieval Augmented Generation platform with ingestion, query, graph, intelligence, dashboard, and MCP access layers.

This repository contains the full RAG stack for:

- document ingestion and preview
- vector retrieval and query orchestration
- graph extraction and graph querying
- reranking
- feedback / intelligence / self-learning workflows
- web admin dashboard
- MCP server integration

The implementation is split into Python FastAPI services and a Next.js dashboard, coordinated through `docker-compose.yml`.

## ภาษาไทย

ระบบ RAG แบบ microservices ที่ประกอบด้วย ingestion, query, graph, intelligence, dashboard และ MCP server

โปรเจคนี้ครอบคลุมงานหลักดังนี้:

- รับเอกสารเข้าระบบและดูตัวอย่างก่อนประมวลผล
- ค้นคืนข้อมูลด้วย vector retrieval และ orchestration ของคำถาม
- ดึง entity / สร้างกราฟ และ query กราฟ
- reranking ผลลัพธ์
- workflow ฝั่ง feedback, intelligence และ self-learning
- dashboard สำหรับ admin / operator
- เชื่อมต่อผ่าน MCP server

โค้ดหลักแบ่งเป็น FastAPI services ฝั่ง Python และ Next.js dashboard โดยใช้ `docker-compose.yml` เป็นตัวรวมระบบ

## Repository Structure / โครงสร้างโปรเจค

- `core/rag-service` - main query service and retrieval pipeline / service หลักสำหรับ query และ retrieval
- `core/graph-service` - entity extraction and graph query APIs / API สำหรับ extraction และ query กราฟ
- `core/reranker-service` - reranking backends / backend สำหรับ rerank
- `ingestion/ingestion-service` - file/text ingestion, preview, job queue, versioning / ingestion จากไฟล์หรือข้อความ, preview, queue, versioning
- `ingestion/knowledge-connector` - external knowledge acquisition and connector workflows / งานดึงความรู้จากภายนอก
- `intelligence/intelligence-service` - analysis, gap processing, candidate lifecycle jobs / งานวิเคราะห์, ประมวลผล gap และ scheduled jobs
- `platform/dashboard` - admin and operator UI / หน้าจอ admin และ operator
- `platform/mcp-server` - MCP client/server bridge for the RAG stack / bridge สำหรับ MCP
- `shared` - shared utilities and configuration used by multiple services / utility และ config ที่ใช้ร่วมกัน
- `scripts` - DB migrations and operational scripts / migration และสคริปต์งานปฏิบัติการ
- `docs` - repository-level policy and supporting documents / เอกสาร policy และเอกสารสนับสนุน

## What The Code Does / สิ่งที่โค้ดทำจริง

This summary is based on the service entrypoints, route files, Docker setup, config, and tests in the repo.

สรุปนี้อิงจาก entrypoint, route, Docker setup, config และ test ที่มีอยู่จริงใน repo

### Ingestion Service / Service สำหรับ Ingestion

The ingestion service accepts files or plain text, normalizes MIME types, enqueues jobs in Redis, and processes them with a background worker.

บริการนี้รับไฟล์หรือข้อความ, ตรวจ MIME type, สร้าง job เข้า Redis queue และประมวลผลด้วย worker เบื้องหลัง

Main capabilities in code / ความสามารถหลักในโค้ด:

- multipart file ingestion / รับไฟล์แบบ multipart
- text ingestion / รับข้อความตรง
- preview mode without persisting the job / preview โดยไม่ต้อง enqueue จริง
- job status, retry, cancel, reprocess, and queue stats / ดูสถานะ, retry, cancel, reprocess และสถิติ queue
- document delete / rollback / chunk inspection / ลบเอกสาร, rollback version, ดู chunk
- document version tracking / ติดตาม version ของเอกสาร

Relevant code / ไฟล์ที่เกี่ยวข้อง:

- `ingestion/ingestion-service/main.py`
- `ingestion/ingestion-service/interface/routers.py`
- `ingestion/ingestion-service/application/ingestion_worker.py`
- `ingestion/ingestion-service/infrastructure/adapters/job_queue.py`

### Query and Retrieval / ฝั่ง Query และ Retrieval

The RAG service is the main query path. It wires retrieval, reranking, cache, memory, context building, citation verification, and model routing.

RAG service เป็นเส้นทางหลักของ query โดยผูก retrieval, reranking, cache, memory, context building, citation verification และการเลือก model

Relevant code / ไฟล์ที่เกี่ยวข้อง:

- `core/rag-service/main.py`
- `core/rag-service/interface/routers.py`
- `core/rag-service/application/query_use_case.py`
- `core/rag-service/application/context_builder.py`
- `core/rag-service/application/context_compressor.py`

### Graph Service / ฝั่ง Graph

The graph service exposes graph extraction and querying APIs backed by Neo4j and entity extractors.

Graph service เปิด API สำหรับ extraction และ query กราฟ โดยใช้ Neo4j และตัวดึง entity

Relevant code / ไฟล์ที่เกี่ยวข้อง:

- `core/graph-service/main.py`
- `core/graph-service/interface/routers.py`
- `core/graph-service/application/extract_entities_use_case.py`
- `core/graph-service/application/graph_query_use_case.py`

### Intelligence Service / ฝั่ง Intelligence

The intelligence service runs scheduled jobs for analysis, expiry, and gap processing.

Intelligence service รันงานแบบ scheduled สำหรับ analysis, expiry และ gap processing

Relevant code / ไฟล์ที่เกี่ยวข้อง:

- `intelligence/intelligence-service/main.py`
- `intelligence/intelligence-service/application/evaluation_use_cases.py`
- `intelligence/intelligence-service/application/feedback_use_cases.py`
- `intelligence/intelligence-service/application/self_learning_use_cases.py`

### Knowledge Connector / ตัวเชื่อมความรู้

This service handles external knowledge sources and connector logic.

Service นี้ดูแลงานดึงความรู้จากแหล่งภายนอกและ logic ของ connector

Relevant code / ไฟล์ที่เกี่ยวข้อง:

- `ingestion/knowledge-connector/main.py`
- `ingestion/knowledge-connector/interface/routers.py`
- `ingestion/knowledge-connector/application/use_cases.py`

### Platform / ฝั่ง Platform

The dashboard is a Next.js app for operator and admin workflows. The MCP server exposes programmatic access to the services.

Dashboard เป็น Next.js app สำหรับ operator/admin ส่วน MCP server ใช้เปิดทางให้เรียกใช้ service ต่าง ๆ แบบ programmatic

Relevant code / ไฟล์ที่เกี่ยวข้อง:

- `platform/dashboard/package.json`
- `platform/dashboard/src/app/*`
- `platform/mcp-server/package.json`
- `platform/mcp-server/src/*`

## Requirement / Design / Task Mapping

I checked the repository for separate files named `Requirement`, `Design`, and `Task`, but there are no dedicated documents with those names in this checkout.

ผมตรวจแล้วว่าใน repo นี้ไม่มีไฟล์เอกสารแยกชื่อ `Requirement`, `Design`, หรือ `Task` โดยตรง

So this README maps those concepts to the actual codebase below.

ดังนั้น README นี้จะ map แนวคิดทั้ง 3 ส่วนกับ source code จริงแทน

| Concept | English interpretation | Thai interpretation | Source code evidence |
|---|---|---|---|
| Requirement | What the system must do | ระบบต้องทำอะไรบ้าง | `docker-compose.yml`, `rag-config.yaml`, `tests/*` |
| Design | How the system is organized | โครงสร้างและสถาปัตยกรรมของระบบ | `core/*`, `ingestion/*`, `intelligence/*`, `platform/*`, `shared/*` |
| Task | Concrete implementation work | งานที่ลงมือทำจริงในโค้ด | service entrypoints, routers, adapters, tests |

### Requirement Coverage / การครอบคลุม Requirement

Based on the current codebase, the implemented requirements include:

- document ingestion and extraction
- preview before ingestion
- queue-based async ingestion
- document versioning and rollback
- vector retrieval and RAG answering
- graph extraction and graph query
- reranking support
- intelligence / feedback / self-learning workflows
- dashboard UI
- MCP integration

จาก codebase ปัจจุบัน requirement ที่มีการรองรับแล้ว ได้แก่:

- ingestion และ extraction เอกสาร
- preview ก่อน ingest จริง
- ingestion แบบ async ผ่าน queue
- versioning และ rollback ของเอกสาร
- vector retrieval และการตอบแบบ RAG
- การ extract และ query กราฟ
- reranking
- workflow ฝั่ง intelligence / feedback / self-learning
- dashboard UI
- การเชื่อม MCP

### Design Coverage / การครอบคลุม Design

The design follows a layered / hexagonal style:

- `domain` contains entities and errors
- `application` contains use cases and ports
- `infrastructure` contains adapters to Redis, PostgreSQL, ChromaDB, Neo4j, Ollama, and external clients
- `interface` contains FastAPI routers, dependencies, and auth middleware

สถาปัตยกรรมเป็นแนว layered / hexagonal:

- `domain` เก็บ entities และ errors
- `application` เก็บ use case และ port
- `infrastructure` เก็บ adapter สำหรับ Redis, PostgreSQL, ChromaDB, Neo4j, Ollama และ client ภายนอก
- `interface` เก็บ FastAPI routers, dependencies และ auth middleware

### Task Coverage / งานที่มีอยู่จริง

Examples of concrete implementation tasks that exist in the repo:

- ingest job queue and worker
- preview and extraction endpoints
- document version list and rollback endpoints
- graph extraction and query endpoints
- scheduled intelligence jobs
- dashboard screens for jobs, documents, graph, cache, memory, approvals, and report
- MCP client methods for service access

ตัวอย่างงานที่ลงมือทำจริงใน repo:

- job queue และ worker สำหรับ ingestion
- endpoint สำหรับ preview และ extraction
- endpoint สำหรับ list version และ rollback เอกสาร
- endpoint สำหรับ graph extraction และ query
- scheduled job ฝั่ง intelligence
- หน้า dashboard สำหรับ jobs, documents, graph, cache, memory, approvals และ report
- MCP client methods สำหรับเรียก service ต่าง ๆ

## Runtime Dependencies / Dependencies ที่ใช้ตอนรัน

Core runtime services used by the stack:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

บริการหลักที่ระบบต้องใช้ตอนรัน:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

## Local Development / การรันในเครื่อง

Typical full-stack startup:

```bash
docker compose up -d --build
```

คำสั่งเริ่มระบบแบบ full stack โดยทั่วไป:

```bash
docker compose up -d --build
```

Common service ports from `docker-compose.yml`:

- `3000` - MCP server
- `3001` - dashboard
- `8000` - RAG service
- `8001` - ingestion service
- `8002` - graph service
- `8003` - intelligence service
- `8004` - ChromaDB
- `8005` - reranker service
- `8006` - knowledge connector

พอร์ตหลักจาก `docker-compose.yml`:

- `3000` - MCP server
- `3001` - dashboard
- `8000` - RAG service
- `8001` - ingestion service
- `8002` - graph service
- `8003` - intelligence service
- `8004` - ChromaDB
- `8005` - reranker service
- `8006` - knowledge connector

## Testing / การทดสอบ

The repository includes tests for ingestion, graph, RAG, intelligence, knowledge connector, and shared pipeline behaviors.

ใน repo นี้มี test ครอบคลุม ingestion, graph, RAG, intelligence, knowledge connector และ behavior ของ pipeline ร่วม

Example:

```bash
cd ingestion/ingestion-service
pytest
```

ตัวอย่าง:

```bash
cd ingestion/ingestion-service
pytest
```

## Notes / หมายเหตุ

- Generated assets such as `node_modules`, `.next`, `dist`, `__pycache__`, and `.pytest_cache` should not be committed.
- Environment values are read from `.env` / compose variables at runtime.

- ไฟล์ที่ generate อัตโนมัติ เช่น `node_modules`, `.next`, `dist`, `__pycache__`, และ `.pytest_cache` ไม่ควร commit
- ค่าการตั้งค่าต่าง ๆ อ่านจาก `.env` และ environment variables ของ compose ตอน runtime
