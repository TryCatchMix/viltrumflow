# --- Dependencias (compartidas por desarrollo y build) ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Desarrollo: servidor con recarga en caliente ---
FROM deps AS dev
COPY . .
EXPOSE 4200
CMD ["npx", "ng", "serve", "--host", "0.0.0.0", "--poll", "2000"]

# --- Build de producción ---
FROM deps AS build
COPY . .
RUN npx ng build --configuration production

# --- Producción: nginx sirve la SPA y hace de proxy de /api/ ---
FROM nginx:1.27-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
