"""
Intelligence Service — FastAPI entry point with APScheduler cron jobs.
"""
import asyncio
import logging
import os

from fastapi import FastAPI
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from interface.routers import router
from interface.dependencies import get_analyze_uc, get_expire_uc, get_process_gaps_uc

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Intelligence Service", version="1.0.0")
app.include_router(router)

scheduler = AsyncIOScheduler()


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "intelligence-service"}


async def _run_analysis():
    try:
        uc = await get_analyze_uc()
        candidates = await uc.execute()
        logger.info("Scheduled analysis: proposed %d candidates", len(candidates))
    except Exception as exc:
        logger.error("Scheduled analysis failed: %s", exc)


async def _run_expiry():
    try:
        uc = await get_expire_uc()
        count = await uc.execute()
        if count:
            logger.info("Scheduled expiry: expired %d candidates", count)
    except Exception as exc:
        logger.error("Scheduled expiry failed: %s", exc)


async def _run_process_gaps():
    try:
        uc = await get_process_gaps_uc()
        promoted = await uc.execute()
        if promoted:
            logger.info("Scheduled gap processing: promoted %d gaps", promoted)
    except Exception as exc:
        logger.error("Scheduled gap processing failed: %s", exc)


@app.on_event("startup")
async def startup():
    interval_hours = int(os.getenv("ANALYSIS_INTERVAL_HOURS", "24"))
    scheduler.add_job(_run_analysis, "interval", hours=interval_hours,
                      id="analyze_interactions", replace_existing=True)
    scheduler.add_job(_run_expiry, "interval", hours=1,
                      id="expire_candidates", replace_existing=True)
    gap_interval_hours = int(os.getenv("GAP_PROCESSING_INTERVAL_HOURS", "6"))
    scheduler.add_job(_run_process_gaps, "interval", hours=gap_interval_hours,
                      id="process_gaps", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started (analysis every %dh, expiry every 1h, gaps every %dh)",
                interval_hours, gap_interval_hours)


@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown(wait=False)
