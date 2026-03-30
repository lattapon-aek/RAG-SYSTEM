# เอกสารภาษาไทย

เอกสารในโฟลเดอร์นี้เป็นฉบับเสริมภาษาไทยของเอกสารหลักภาษาอังกฤษ

## ควรอ่านอะไรก่อน

| ลำดับ | อ่านไฟล์นี้ | เหตุผล |
|---|---|---|
| 1 | [Environment](environment.md) | ดูค่าที่ต้องใช้เพื่อบูตระบบขั้นต่ำ |
| 2 | [Requirement](requirement.md) | เข้าใจว่าระบบต้องทำอะไร |
| 3 | [Design](design.md) | เข้าใจโครงสร้างและสถาปัตยกรรม |
| 4 | [Task](task.md) | ดูงานที่ลงมือทำจริงใน repo |

## สารบัญ

- [Environment](environment.md)
- [Requirement](requirement.md)
- [Design](design.md)
- [Task](task.md)

## System Flow

```text
ผู้ใช้ / operator
  -> Dashboard หรือ MCP server
  -> Service entrypoint
  -> API router และ dependency wiring
  -> Application use case
  -> Infrastructure adapter
  -> ฐานข้อมูล / vector store / graph store / queue
  -> Response กลับไปยังผู้เรียก
```

```mermaid
flowchart LR
    U[ผู้ใช้ / operator] --> D[Dashboard]
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

## หมายเหตุ

- เอกสารภาษาอังกฤษใน `docs/` เป็นเอกสารหลัก
- เอกสารภาษาไทยจัดทำเพื่อช่วยอ่านและอ้างอิง
