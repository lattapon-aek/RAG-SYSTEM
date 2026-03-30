"""
Knowledge Connector Service — FastAPI entry point.
"""
import logging

from fastapi import FastAPI
from interface.routers import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = FastAPI(title="Knowledge Connector", version="1.0.0")
app.include_router(router)
