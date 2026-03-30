import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware

# ดึง router หลักของ service นี้มาใช้สำหรับประกาศ endpoint
from interface.routers import router
# ดึง dependency ที่ใช้สร้าง use case และเก็บ queue กลางของแอป
from interface.dependencies import get_ingest_use_case, _job_queue, set_job_queue
# ตัว adapter ที่คุยกับ Redis สำหรับเก็บ job ingestion
from infrastructure.adapters.job_queue import IngestionJobQueue
# background worker ที่คอยดึง job จาก queue ไปประมวลผล
from application.ingestion_worker import ingestion_worker

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──
    # ตอนแอปเริ่มทำงาน: สร้าง Redis queue, ผูกเข้ากับ dependency และเปิด worker
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    queue = IngestionJobQueue(redis_url=redis_url)
    set_job_queue(queue)

    # สร้าง use case หลักของ ingestion เพื่อให้ worker เรียกใช้ได้
    use_case = get_ingest_use_case()
    # เปิด worker เป็น background task เพื่อประมวลผล job แบบ async
    worker_task = asyncio.create_task(ingestion_worker(queue, use_case))
    logger.info("Ingestion worker task started")

    # FastAPI จะหยุดค้างอยู่ที่บรรทัดนี้ระหว่างช่วงที่ service ทำงานปกติ
    yield

    # ── Shutdown ──
    # ตอนปิดแอป: ยกเลิก worker ก่อน แล้วค่อยปิดการเชื่อมต่อ Redis
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
    await queue.close()
    logger.info("Ingestion worker stopped")


# สร้าง FastAPI app หลักของ ingestion service
app = FastAPI(title="Ingestion Service", version="1.0.0", lifespan=lifespan)

# รองรับการ import ได้ทั้งแบบ absolute และ relative
try:
    from interface.auth import api_key_middleware
except ImportError:
    from .interface.auth import api_key_middleware
    from .interface.routers import router

# เพิ่ม middleware สำหรับตรวจ API key ก่อนเข้า endpoint ต่าง ๆ
app.add_middleware(BaseHTTPMiddleware, dispatch=api_key_middleware)
# ผูก router เพื่อให้ endpoint ที่ประกาศไว้ใน interface/routers.py ใช้งานได้
app.include_router(router)
