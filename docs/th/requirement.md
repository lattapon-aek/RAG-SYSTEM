# Requirement

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

### เอกสาร walkthrough ที่เกี่ยวข้อง

ถ้าต้องการเห็นความต้องการเหล่านี้เป็น flow การทำงานจริง ให้อ่าน:

- [Ingestion walkthrough](ingestion-walkthrough.md)
- [Query walkthrough](query-walkthrough.md)
