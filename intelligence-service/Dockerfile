FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY intelligence-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY intelligence-service/ ./ 
COPY shared ./shared

ENV PYTHONPATH=/app:/app/shared
ENV PYTHONUNBUFFERED=1

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
