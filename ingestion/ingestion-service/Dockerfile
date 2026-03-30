FROM python:3.11-slim

WORKDIR /app

COPY ingestion/ingestion-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model
RUN python -m spacy download en_core_web_sm

COPY ingestion/ingestion-service/ ./
COPY shared ./shared

ENV PYTHONPATH=/app:/app/shared

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
