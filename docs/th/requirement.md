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
- มีการสร้าง memory profile แบบ admin-only และจัดการ memory entry แยกจากกัน
- มี service key registry ที่อนุญาตให้ client_id เดียวมี active key ได้เพียงหนึ่งอัน
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

### แผนที่ requirement ไป walkthrough

ใช้ตารางนี้เมื่ออยากกระโดดจาก requirement ไปยังเส้นทางโค้ดที่เกี่ยวข้อง:

| ส่วนของ requirement | อ่านต่อ |
|---|---|
| Document ingestion, preview, queue, status, retry, cancel, rollback, chunk inspection | [Ingestion walkthrough](ingestion-walkthrough.md) |
| Vector retrieval, RAG answer generation, reranking, cache, memory, citation | [Query walkthrough](query-walkthrough.md) |
| Graph extraction และ graph querying | [Ingestion walkthrough](ingestion-walkthrough.md) และ [Query walkthrough](query-walkthrough.md) |
| Intelligence workflows และ background analysis | [Query walkthrough](query-walkthrough.md) |
| Dashboard และ MCP access | [Query walkthrough](query-walkthrough.md) และ [Ingestion walkthrough](ingestion-walkthrough.md) |
| การสร้าง memory profile และการจัดการ memory | [Query walkthrough](query-walkthrough.md) |
| Service key registry และ active key ต่อ client_id | [Task](task.md) และ [Environment](environment.md) |
