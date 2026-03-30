# Task

## ภาษาไทย

เอกสารนี้สรุปงานที่ลงมือทำจริงใน repo

ถ้าต้องการดูงานเหล่านี้ในรูปของ flow การทำงานจริง ให้อ่าน:

- [Ingestion walkthrough](ingestion-walkthrough.md)
- [Query walkthrough](query-walkthrough.md)

ถ้าต้องการไล่ย้อนกลับจากงานเหล่านี้ไปยังเอกสารระดับสูง ให้อ่าน:

- [Requirement](requirement.md) เพื่อดูพฤติกรรมที่ระบบคาดหวัง
- [Design](design.md) เพื่อดูสถาปัตยกรรมและ boundary ของ service

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
