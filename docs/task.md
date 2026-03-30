# Task / งานที่ลงมือทำจริง

## English

This document groups the main implementation tasks that exist in the repository.

### Ingestion tasks

- Implement file and text ingestion endpoints
- Build Redis-backed ingestion queue
- Run a background ingestion worker
- Add preview, retry, cancel, reprocess, and status endpoints
- Add document deletion, rollback, and chunk inspection endpoints
- Add document version tracking

### Query / graph tasks

- Implement the main RAG query pipeline
- Add retrieval, reranking, cache, memory, and citation support
- Implement graph extraction and graph querying
- Add adapters for ChromaDB, Neo4j, and model providers

### Intelligence tasks

- Schedule analysis and expiry jobs
- Process knowledge gaps
- Persist feedback and approval workflow data

### Platform tasks

- Build the Next.js dashboard
- Add admin screens for jobs, documents, graph, cache, memory, and approvals
- Expose MCP clients for service access

### Evidence in code

- `ingestion/ingestion-service/*`
- `core/rag-service/*`
- `core/graph-service/*`
- `intelligence/intelligence-service/*`
- `platform/dashboard/*`
- `platform/mcp-server/*`
- `tests/*`

## ภาษาไทย

เอกสารนี้สรุปงานที่ลงมือทำจริงใน repo

### งานฝั่ง ingestion

- ทำ endpoint สำหรับรับไฟล์และข้อความ
- สร้าง Redis-backed ingestion queue
- รัน background worker สำหรับประมวลผล job
- เพิ่ม endpoint สำหรับ preview, retry, cancel, reprocess และดูสถานะ
- เพิ่ม endpoint สำหรับลบเอกสาร, rollback และดู chunk
- เพิ่มการติดตาม version ของเอกสาร

### งานฝั่ง query / graph

- ทำ pipeline หลักของ RAG query
- เพิ่ม retrieval, reranking, cache, memory และ citation support
- ทำ graph extraction และ graph querying
- เพิ่ม adapter สำหรับ ChromaDB, Neo4j และ provider ของ model

### งานฝั่ง intelligence

- ตั้ง scheduled job สำหรับ analysis และ expiry
- ประมวลผล knowledge gaps
- จัดเก็บ feedback และ approval workflow

### งานฝั่ง platform

- สร้าง Next.js dashboard
- ทำหน้า admin สำหรับ jobs, documents, graph, cache, memory และ approvals
- เปิด MCP client สำหรับเรียก service ต่าง ๆ

### หลักฐานในโค้ด

- `ingestion/ingestion-service/*`
- `core/rag-service/*`
- `core/graph-service/*`
- `intelligence/intelligence-service/*`
- `platform/dashboard/*`
- `platform/mcp-server/*`
- `tests/*`
