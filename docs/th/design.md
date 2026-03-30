# Design

## ภาษาไทย

เอกสารนี้อธิบายสถาปัตยกรรมที่ใช้จริงใน repo

### รูปแบบสถาปัตยกรรม

ระบบนี้ใช้แนว layered / hexagonal:

- `domain` สำหรับ entities และ errors
- `application` สำหรับ use case และ port
- `infrastructure` สำหรับ adapter ที่เชื่อมระบบภายนอก
- `interface` สำหรับ FastAPI routers, dependencies และ auth middleware

### ขอบเขตของแต่ละ service

- `core/rag-service` ดูแล query orchestration, retrieval, reranking, memory และ citation
- `core/graph-service` ดูแล entity extraction และ graph APIs
- `core/reranker-service` แยก backend สำหรับ reranking
- `ingestion/ingestion-service` ดูแล ingestion, preview, job queue และ document versioning
- `ingestion/knowledge-connector` ดูแลการเก็บความรู้จากแหล่งภายนอก
- `intelligence/intelligence-service` ดูแลงาน intelligence แบบ scheduled
- `platform/dashboard` เป็นชั้น UI
- `platform/mcp-server` เป็นชั้นเข้าถึง service ผ่าน MCP

### ระบบที่ต้องพึ่งพา

stack นี้พึ่งพา:

- PostgreSQL / PgBouncer
- Redis
- ChromaDB
- Neo4j
- Ollama
- Jaeger
- Traefik

### หลักฐานในโค้ด

- `core/*`
- `ingestion/*`
- `intelligence/*`
- `platform/*`
- `shared/*`
- `docker-compose.yml`

### เอกสาร walkthrough ที่เกี่ยวข้อง

ชั้น design จะอ่านง่ายขึ้นถ้าตาม flow การทำงานจริง:

- [Ingestion walkthrough](ingestion-walkthrough.md) สำหรับ ingestion pipeline และ worker flow
- [Query walkthrough](query-walkthrough.md) สำหรับ retrieval, reranking และ answer generation
