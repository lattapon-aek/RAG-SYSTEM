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

- `core/rag-service` ดูแล query orchestration, retrieval, reranking, memory, grounding และ context brief assembly
- `core/graph-service` ดูแล entity extraction และ graph APIs
- `core/reranker-service` แยก backend สำหรับ reranking รวมถึงเส้นทาง LLM/Typhoon reranker
- `ingestion/ingestion-service` ดูแล ingestion, preview, job queue และ document versioning
- `ingestion/knowledge-connector` ดูแลการเก็บความรู้จากแหล่งภายนอก
- `intelligence-service` ดูแลงาน intelligence แบบ scheduled
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
- `intelligence-service/*`
- `platform/*`
- `shared/*`
- `docker-compose.yml`

### เอกสาร walkthrough ที่เกี่ยวข้อง

ชั้น design จะอ่านง่ายขึ้นถ้าตาม flow การทำงานจริง:

- [Ingestion walkthrough](ingestion-walkthrough.md) สำหรับ ingestion pipeline และ worker flow
- [Query walkthrough](query-walkthrough.md) สำหรับ retrieval, reranking และ context brief assembly

### แผนที่ design ไป walkthrough

ใช้ตารางนี้เมื่ออยากกระโดดจากหัวข้อ architecture ไปยัง flow การทำงานที่เกี่ยวข้อง:

| หัวข้อ design | อ่านต่อ |
|---|---|
| Layered / hexagonal boundaries | [Ingestion walkthrough](ingestion-walkthrough.md) และ [Query walkthrough](query-walkthrough.md) |
| Service boundaries และ data ownership | [Service Map](README.md#service-map) |
| รายละเอียดภายใน ingestion service | [Ingestion walkthrough](ingestion-walkthrough.md) |
| การ orchestration ของ RAG service | [Query walkthrough](query-walkthrough.md) |
| การเชื่อม graph และ reranker | [Query walkthrough](query-walkthrough.md) |
| งาน intelligence และ background analysis | [Query walkthrough](query-walkthrough.md) |
