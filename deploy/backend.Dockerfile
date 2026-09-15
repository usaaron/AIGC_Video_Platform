FROM dockerproxy.net/library/python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app/backend:/app
WORKDIR /app
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY deploy/requirements.lock /app/deploy/requirements.lock
RUN pip install --no-cache-dir --index-url ${PIP_INDEX_URL} -r deploy/requirements.lock
COPY backend backend
COPY evaluation evaluation
COPY datasets datasets
COPY migrations migrations
COPY scripts scripts
COPY alembic.ini pyproject.toml README.md ./
RUN groupadd --gid 10001 scriptmaster && useradd --uid 10001 --gid 10001 --no-create-home scriptmaster \
    && mkdir -p /var/lib/script-master/reports && chown -R 10001:10001 /var/lib/script-master
ENV SCRIPT_MASTER_REPORT_ROOT=/var/lib/script-master/reports
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
