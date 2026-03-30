FROM python:3.12-slim

WORKDIR /app

COPY core/rag-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY core/rag-service/ ./
COPY shared ./shared

ENV PYTHONPATH=/app:/app/shared

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
