# Environment

เอกสารนี้สรุป environment variables ที่สำคัญที่สุดสำหรับการรัน local และการเริ่มใช้งานครั้งแรก

ไฟล์นี้เป็นเอกสารประกอบของ `.env.example` ไม่ใช่ตัวแทนของไฟล์นั้น

## ตารางค่าหลัก

| ตัวแปร | ค่า default ใน repo | เมื่อไหร่ควรเปลี่ยน | ผลกระทบ |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `change-me-in-production` | ก่อนใช้งานจริง | ป้องกัน PostgreSQL |
| `POSTGRES_URL` | URL ของ PostgreSQL ใน Compose | เมื่อใช้ DB host อื่น | ชี้บริการ ingestion, RAG, intelligence ไปที่ Postgres |
| `NEO4J_PASSWORD` | `change-me-in-production` | ก่อนใช้งานจริง | ป้องกัน Neo4j |
| `NEXTAUTH_SECRET` | `change-me-in-production` | เมื่อเปิด auth ของ dashboard | ใช้เซ็น session ของ NextAuth |
| `REDIS_URL` | `redis://redis:6379` | เมื่อ Redis อยู่นอก Compose | ใช้กับ queue และ cache |
| `CHROMA_URL` | `http://chromadb:8004` | เมื่อ ChromaDB อยู่นอก Compose | ใช้กับ vector store |
| `NEO4J_URL` | `bolt://neo4j:7687` | เมื่อ Neo4j อยู่นอก Compose | ใช้กับ graph service |
| `LLM_PROVIDER` | `ollama` | เมื่อเปลี่ยน provider | กำหนด default LLM routing |
| `EMBEDDING_PROVIDER` | `ollama` | เมื่อ embeddings มาจาก provider อื่น | กำหนด embedding backend |
| `RERANKER_BACKEND` | `noop` | เมื่อเปิด reranking จริง | มีผลต่อการ rerank passage |
| `SECRET_BACKEND` | `env` | เมื่อย้าย secrets ไป Vault/AWS | กำหนดแหล่งเก็บ secrets |
| `RAG_SERVICE_API_KEY` | ว่าง | เมื่ออยากบังคับใช้ API key ของ RAG service | เปิดการ auth สำหรับ request เข้า RAG service |
| `INGESTION_SERVICE_API_KEY` | ว่าง | เมื่ออยากบังคับใช้ API key ของ ingestion service | เปิดการ auth สำหรับ request เข้า ingestion service |
| `SERVICE_REQUIRE_DB_API_KEYS` | `false` | เมื่ออยากบังคับให้ใช้ DB-backed key | ปฏิเสธ request ที่ไม่มี key ที่ถูกต้องจาก DB |
| `CHUNKER_STRATEGY` | `fixed` | เมื่ออยากเปลี่ยน chunking | พฤติกรรมการ chunk เอกสาร |
| `GRAPH_EXTRACTOR_BACKEND` | `llm` | เมื่ออยากใช้ Spacy เร็วขึ้น | คุณภาพ vs ความเร็วของ graph extraction |
| `CHROMA_COLLECTION_PREFIX` | `rag_1024` | เมื่อแยกข้อมูลเป็นชุดต่าง ๆ | ชื่อ collection ของ vector store |
| `ANALYSIS_INTERVAL_HOURS` | `24` | เมื่อปรับรอบ intelligence | ความถี่งาน scheduled analysis |
| `GAP_PROCESSING_INTERVAL_HOURS` | `6` | เมื่อปรับรอบ gap processing | ความถี่งาน review gap |
| `TRAEFIK_RATE_LIMIT_RPS` | `100` | เมื่อปรับการป้องกัน ingress | rate limit ของ reverse proxy |

## ค่าเริ่มต้นขั้นต่ำ

ถ้าต้องการให้ระบบบูต local ได้ก่อน ให้เริ่มด้วย:

```env
POSTGRES_PASSWORD=change-me-in-production
POSTGRES_URL=postgresql://postgres:change-me-in-production@postgres:5432/ragdb
NEO4J_PASSWORD=change-me-in-production
NEXTAUTH_SECRET=change-me-in-production
RERANKER_BACKEND=noop
SECRET_BACKEND=env
RAG_SERVICE_API_KEY=
INGESTION_SERVICE_API_KEY=
```

## หมายเหตุ

- ค่า service URL ส่วนใหญ่ตั้งค่า default เป็นชื่อ service ใน Docker Compose อยู่แล้ว
- cloud provider keys เช่น `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, และ `TYPHOON_API_KEY` เป็นตัวเลือกเสริม เว้นแต่คุณ route traffic ไป provider เหล่านั้น
- ใน `.env.example` มีคอมเมนต์อธิบายไว้เยอะอยู่แล้ว ให้ถือเป็นแหล่งอ้างอิงหลักสำหรับตัวเลือกทั้งหมด
- Docker Compose จะ map `RAG_SERVICE_API_KEY` และ `INGESTION_SERVICE_API_KEY` เข้า MCP server เป็น `MCP_RAG_SERVICE_API_KEY` และ `MCP_INGESTION_SERVICE_API_KEY`

## เอกสารที่เกี่ยวข้อง

ถ้าต้องการเชื่อมการตั้งค่า environment กับเส้นทางการเรียนรู้ที่เหลือ ให้อ่าน:

- [Documentation index](README.md)
- [Requirement](requirement.md) เพื่อดูเป้าหมายของระบบที่ตัวแปรพวกนี้รองรับ
- [Design](design.md) เพื่อดู boundary ของ service ที่ใช้ค่าพวกนี้
- [Task](task.md) เพื่อดูจุดที่ configuration มีผลต่อ implementation
