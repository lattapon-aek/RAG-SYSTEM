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
| `QUERY_REWRITE_LLM_PROVIDER` / `QUERY_REWRITE_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | ขั้น rewrite query | LLM สำหรับเขียน query ใหม่ก่อนค้น |
| `HYDE_LLM_PROVIDER` / `HYDE_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | ขั้น HyDE | LLM สำหรับสร้าง hypothetical document |
| `QUERY_DECOMPOSER_LLM_PROVIDER` / `QUERY_DECOMPOSER_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | ขั้นแตก query | LLM สำหรับแยก query ซับซ้อนเป็น sub-query |
| `QUERY_SEED_LLM_PROVIDER` / `QUERY_SEED_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | ขั้นสกัด graph seed | LLM สำหรับดึง entity seed ให้ Graph |
| `COMPRESSOR` | `llm` | เมื่ออยากให้ context builder บีบ context ออกมาเป็น brief แบบใกล้คำตอบเสมอ | กำหนดว่าผล retrieval จะคง raw, เป็น extractive, หรือเป็น LLM-compressed |
| `COMPRESSION_LLM_PROVIDER` / `COMPRESSION_LLM_MODEL` | `typhoon` / `typhoon-v2.5-30b-a3b-instruct` | ขั้นบีบ context | LLM สำหรับย่อ context เมื่อยาวเกิน |
| `COMPRESSION_LLM_SYSTEM_PROMPT` | ว่าง | เมื่ออยากปรับ prompt ของ compressor โดยไม่แก้ code | ปรับวิธีบีบ context ที่ส่งต่อให้ agent ภายนอก |
| `EMBEDDING_PROVIDER` | `ollama` | เมื่อ embeddings มาจาก provider อื่น | กำหนด embedding backend |
| `RERANKER_BACKEND` | `llm` | เมื่อเปิด reranking จริง | มีผลต่อการ rerank passage |
| `LLM_RERANKER_URL` / `LLM_RERANKER_MODEL` / `LLM_RERANKER_API_KEY` | `https://api.opentyphoon.ai/v1` / `typhoon-v2.5-30b-a3b-instruct` / ว่าง | เมื่ออยากให้ reranker ใช้ Typhoon หรือ provider ที่รองรับ OpenAI-compatible | ค่าคอนฟิกของ LLM reranker |
| `SECRET_BACKEND` | `env` | เมื่อย้าย secrets ไป Vault/AWS | กำหนดแหล่งเก็บ secrets |
| `RAG_SERVICE_API_KEY` | ว่าง | เมื่ออยากบังคับใช้ API key ของ RAG service | เปิดการ auth สำหรับ request เข้า RAG service |
| `INGESTION_SERVICE_API_KEY` | ว่าง | เมื่ออยากบังคับใช้ API key ของ ingestion service | เปิดการ auth สำหรับ request เข้า ingestion service |
| `SERVICE_REQUIRE_DB_API_KEYS` | `false` | เมื่ออยากบังคับให้ใช้ DB-backed key | ปฏิเสธ request ที่ไม่มี key ที่ถูกต้องจาก DB |
| `CHUNKER_STRATEGY` | `fixed` | เมื่ออยากเปลี่ยน chunking | พฤติกรรมการ chunk เอกสาร |
| `GRAPH_EXTRACTOR_BACKEND` | `llm` | เมื่ออยากใช้ heuristic ที่เบากว่า LLM | คุณภาพ vs ความเร็วของ graph extraction |
| `GRAPH_ENTITY_MAX_TOKENS` | `4096` | เมื่ออยากเพิ่มหรือลด budget ของ graph LLM | token budget สูงสุดสำหรับการ extract graph |
| `GRAPH_ENTITY_SYSTEM_PROMPT` | ว่าง | เมื่ออยากปรับพฤติกรรม graph extraction โดยไม่แก้ code | ปรับ LLM ของ graph extractor ได้จาก env |
| `GRAPH_QUERY_SEED_SYSTEM_PROMPT` | ว่าง | เมื่ออยากปรับการหา graph seed ฝั่ง query โดยไม่แก้ code | ปรับวิธีสกัด entity seed ที่ส่งเข้า graph augmentation |
| `GRAPH_QUERY_SEED_MAX_TOKENS` | `512` | เมื่อ seed extraction ต้องการ budget เพิ่มหรือลด | token budget สูงสุดสำหรับ query-side graph seed extraction |
| `CHROMA_COLLECTION_PREFIX` | `rag_1024` | เมื่อแยกข้อมูลเป็นชุดต่าง ๆ | ชื่อ collection ของ vector store |
| `ANALYSIS_INTERVAL_HOURS` | `24` | เมื่อปรับรอบ intelligence | ความถี่งาน scheduled analysis |
| `GAP_PROCESSING_INTERVAL_HOURS` | `6` | เมื่อปรับรอบ gap processing | ความถี่งาน review gap |
| `TRAEFIK_RATE_LIMIT_RPS` | `100` | เมื่อปรับการป้องกัน ingress | rate limit ของ reverse proxy |

ChromaDB ตอนนี้ใช้ resource profile เฉพาะใน `docker-compose.yml` เพราะมันอยู่บน retrieval hot path. โปรไฟล์ปัจจุบันคือ `0.25 CPU / 512 MB RAM / 80 pids`; ถ้ายังรู้สึกช้า จุดแรกที่ควรเพิ่มคือส่วนนี้.

## ค่าเริ่มต้นขั้นต่ำ

ถ้าต้องการให้ระบบบูต local ได้ก่อน ให้เริ่มด้วย:

```env
POSTGRES_PASSWORD=change-me-in-production
POSTGRES_URL=postgresql://postgres:change-me-in-production@postgres:5432/ragdb
NEO4J_PASSWORD=change-me-in-production
NEXTAUTH_SECRET=change-me-in-production
RERANKER_BACKEND=llm
SECRET_BACKEND=env
RAG_SERVICE_API_KEY=
INGESTION_SERVICE_API_KEY=
```

## หมายเหตุ

- ค่า service URL ส่วนใหญ่ตั้งค่า default เป็นชื่อ service ใน Docker Compose อยู่แล้ว
- cloud provider keys เช่น `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, และ `TYPHOON_API_KEY` เป็นตัวเลือกเสริม เว้นแต่คุณ route traffic ไป provider เหล่านั้น
- `GRAPH_QUERY_SEED_SYSTEM_PROMPT` และ `GRAPH_QUERY_SEED_MAX_TOKENS` ใช้ควบคุมตัวสกัด seed ของคำถามก่อนเข้า Graph augmentation
- `LLM_RERANKER_URL`, `LLM_RERANKER_MODEL`, และ `LLM_RERANKER_API_KEY` ใช้กับ reranker แบบ LLM/Typhoon
- `GRAPH_ENTITY_MAX_TOKENS` ใช้ควบคุม budget ของ graph LLM ถ้า prompt ยาวจน provider ปฏิเสธคำขอให้เพิ่มค่านี้
- `GRAPH_ENTITY_SYSTEM_PROMPT` ใช้ปรับพฤติกรรม graph extraction จาก env ได้ โดยไม่ต้องแก้ code เมื่ออยากคง code path เดิมไว้แต่ปรับ ontology หรือสไตล์การ extract
- ใน `.env.example` มีคอมเมนต์อธิบายไว้เยอะอยู่แล้ว ให้ถือเป็นแหล่งอ้างอิงหลักสำหรับตัวเลือกทั้งหมด
- MCP server มีไฟล์ env ของตัวเองที่ `platform/mcp-server/.env` ให้คัดลอกจาก `platform/mcp-server/.env.example` เมื่อต้องการรัน MCP แยกจาก stack หลัก
- Memory profile ตอนนี้เก็บในตาราง `memory_profiles` แยกต่างหาก เพื่อให้ admin สร้าง profile เปล่าได้ก่อนมี memory entry ตัวแรก
- ตาราง `api_keys` บังคับให้ `client_id` เดียวมี active key ได้แค่หนึ่งอัน ต้อง revoke key เดิมก่อนสร้างใหม่สำหรับ client เดิม

## เอกสารที่เกี่ยวข้อง

ถ้าต้องการเชื่อมการตั้งค่า environment กับเส้นทางการเรียนรู้ที่เหลือ ให้อ่าน:

- [Documentation index](README.md)
- [Requirement](requirement.md) เพื่อดูเป้าหมายของระบบที่ตัวแปรพวกนี้รองรับ
- [Design](design.md) เพื่อดู boundary ของ service ที่ใช้ค่าพวกนี้
- [Task](task.md) เพื่อดูจุดที่ configuration มีผลต่อ implementation
- [Memory Profile Registry](../platform/dashboard/src/app/memory-profiles/page.tsx) สำหรับ flow สร้าง profile ของ admin
- [Service Key Registry](../platform/dashboard/src/app/api-keys/ApiKeysUI.tsx) สำหรับ flow service key ที่มี active key เดียวต่อ client
