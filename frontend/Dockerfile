FROM node:20-alpine

WORKDIR /app

# Instalar Angular CLI
RUN npm install -g @angular/cli@19

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

EXPOSE 4200

CMD ["ng", "serve", "--host", "0.0.0.0", "--poll", "2000"]
