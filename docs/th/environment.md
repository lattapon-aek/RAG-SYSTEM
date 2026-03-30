# Environment

เอกสารนี้สรุป environment variables ที่สำคัญที่สุดสำหรับการรัน local และการเริ่มใช้งานครั้งแรก

ไฟล์นี้เป็นเอกสารประกอบของ `.env.example` ไม่ใช่ตัวแทนของไฟล์นั้น

## ค่าที่ต้องมีเพื่อให้ระบบบูตได้

- `POSTGRES_PASSWORD`
- `POSTGRES_URL`
- `NEO4J_PASSWORD`
- `NEXTAUTH_SECRET`
- `ADMIN_JWT_SECRET`

## ค่าที่แนะนำสำหรับรันครั้งแรก

- `REDIS_URL=redis://redis:6379`
- `CHROMA_URL=http://chromadb:8004`
- `NEO4J_URL=bolt://neo4j:7687`
- `LLM_PROVIDER=ollama`
- `EMBEDDING_PROVIDER=ollama`
- `RERANKER_BACKEND=noop`
- `SECRET_BACKEND=env`
- `RAG_API_KEY=` ถ้าต้องการให้ local request ทำงานโดยไม่บังคับใช้ API key

## ค่าที่มักต้องปรับ

- `CHUNKER_STRATEGY`
- `GRAPH_EXTRACTOR_BACKEND`
- `LLM_MODEL`
- `UTILITY_LLM_MODEL`
- `GENERATION_LLM_MODEL`
- `EMBEDDING_MODEL`
- `CHROMA_COLLECTION_PREFIX`
- `ANALYSIS_INTERVAL_HOURS`
- `GAP_PROCESSING_INTERVAL_HOURS`
- `TRAEFIK_RATE_LIMIT_RPS`

## หมายเหตุ

- ค่า service URL ส่วนใหญ่ตั้งค่า default เป็นชื่อ service ใน Docker Compose อยู่แล้ว
- cloud provider keys เช่น `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, และ `TYPHOON_API_KEY` เป็นตัวเลือกเสริม เว้นแต่คุณ route traffic ไป provider เหล่านั้น
- ใน `.env.example` มีคอมเมนต์อธิบายไว้เยอะอยู่แล้ว ให้ถือเป็นแหล่งอ้างอิงหลักสำหรับตัวเลือกทั้งหมด
