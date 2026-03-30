# Requirement / ความต้องการของระบบ

## English

This document summarizes the system requirements that are actually reflected in the current codebase.

### Core requirements

- Document ingestion from file upload and raw text
- Preview mode before ingestion
- Background job queue for ingestion
- Job status, retry, cancel, reprocess, and queue statistics
- Document version history and rollback
- Document chunk inspection
- Vector retrieval and RAG-style answer generation
- Graph extraction and graph querying
- Reranking support
- Intelligence workflows for analysis, feedback, and self-learning
- Admin dashboard for operations
- MCP access for programmatic integration

### Evidence in code

- `docker-compose.yml`
- `rag-config.yaml`
- `ingestion/ingestion-service/interface/routers.py`
- `core/rag-service/interface/routers.py`
- `core/graph-service/interface/routers.py`
- `intelligence/intelligence-service/main.py`
- `platform/dashboard/src/app/*`
- `platform/mcp-server/src/*`
- `tests/*`

## ภาษาไทย

เอกสารนี้สรุปความต้องการของระบบที่สะท้อนอยู่ในโค้ดจริงของโปรเจค

### ความต้องการหลัก

- รับเอกสารจากไฟล์อัปโหลดและข้อความดิบ
- มีโหมด preview ก่อน ingest จริง
- มี queue สำหรับประมวลผล ingestion แบบ background
- ดูสถานะ job, retry, cancel, reprocess และสถิติ queue
- เก็บประวัติ version ของเอกสารและ rollback ได้
- ตรวจดู chunk ของเอกสารได้
- ค้นคืนข้อมูลแบบ vector retrieval และตอบแบบ RAG
- รองรับการ extract และ query กราฟ
- รองรับ reranking
- มี workflow สำหรับ analysis, feedback และ self-learning
- มี dashboard สำหรับงานปฏิบัติการ
- รองรับการเชื่อมต่อผ่าน MCP สำหรับใช้งานแบบ programmatic

### หลักฐานในโค้ด

- `docker-compose.yml`
- `rag-config.yaml`
- `ingestion/ingestion-service/interface/routers.py`
- `core/rag-service/interface/routers.py`
- `core/graph-service/interface/routers.py`
- `intelligence/intelligence-service/main.py`
- `platform/dashboard/src/app/*`
- `platform/mcp-server/src/*`
- `tests/*`
