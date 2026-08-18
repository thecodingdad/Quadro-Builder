# QUADRO 3D mit Backend: App und API aus einem Ursprung.
#
#   docker compose up --build      ->  http://localhost:8000/web/index.html
#
# Die Daten liegen im Volume unter /data (siehe compose.yml). Ohne Volume sind
# gespeicherte Modelle beim naechsten Start weg.

FROM python:3.12-slim

WORKDIR /app

# Erst die Abhaengigkeiten: so bleibt die Schicht im Cache, solange sich
# requirements.txt nicht aendert.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV QUADRO_DATA=/data \
    QUADRO_PORT=8000
EXPOSE 8000

CMD ["python", "server.py"]
