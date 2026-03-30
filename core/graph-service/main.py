import logging

from fastapi import FastAPI
from interface.routers import router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Graph Service", version="1.0.0")
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "healthy"}
