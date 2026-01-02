# Usamos Python oficial
FROM python:3.12-slim

# Set workdir
WORKDIR /app

# Copiamos requirements y los instalamos
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiamos el código
COPY ./app ./app

# Exponemos el puerto
EXPOSE 8000

# Comando por defecto para desarrollo
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--reload"]
