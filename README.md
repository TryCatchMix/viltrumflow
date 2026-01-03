# ViltrumFlow 🚀

**Gestor de Tareas Avanzado** - Sistema profesional de gestión de tareas con FastAPI, PostgreSQL y Angular 19

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11-blue.svg)
![Angular](https://img.shields.io/badge/angular-19-red.svg)
![FastAPI](https://img.shields.io/badge/fastapi-0.109-green.svg)

## 📋 Características

- ✅ **Gestión completa de tareas** con estados, prioridades y asignaciones
- 👥 **Multi-usuario** con roles y permisos
- 📊 **Proyectos** para organizar tareas
- 💬 **Comentarios** en tiempo real
- 🔐 **Autenticación JWT** segura
- 📱 **Diseño responsive** con Angular Material
- 🐳 **Containerizado** con Docker y Docker Compose
- 🔄 **API REST** completa y documentada
- 📈 **Escalable** y listo para producción
- 🔍 **Búsqueda y filtros** avanzados

## 🏗️ Arquitectura

```
┌─────────────────┐
│  Nginx (80/443) │  ← Reverse Proxy & Load Balancer
└────────┬────────┘
         │
    ┌────┴─────┐
    │          │
┌───▼────┐ ┌──▼────────┐
│Frontend│ │  Backend  │
│Angular │ │  FastAPI  │
│  :4200 │ │   :8000   │
└────────┘ └─────┬─────┘
                 │
         ┌───────┴────────┐
         │                │
    ┌────▼─────┐    ┌────▼─────┐
    │PostgreSQL│    │  Redis   │
    │   :5432  │    │  :6379   │
    └──────────┘    └──────────┘
```

## 🚀 Inicio Rápido

### Prerrequisitos

- Docker y Docker Compose
- Make (opcional, recomendado)

### Instalación

1. **Clonar el repositorio**
```bash
git clone https://github.com/tu-usuario/viltrumflow.git
cd viltrumflow
```

2. **Configurar variables de entorno**
```bash
cp .env.example .env
# Edita .env con tus valores
```

3. **Levantar los servicios**
```bash
# Con Make
make install

# Sin Make
docker-compose up -d
docker-compose exec backend alembic upgrade head
```

4. **Acceder a la aplicación**
- Frontend: http://localhost:4200
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- PgAdmin: http://localhost:5050

## 📦 Comandos Disponibles

```bash
# Desarrollo
make up              # Levantar servicios
make down            # Detener servicios
make restart         # Reiniciar servicios
make logs            # Ver logs

# Base de datos
make migrate         # Ejecutar migraciones
make migrate-create  # Crear migración
make db-backup       # Crear backup
make db-restore      # Restaurar backup

# Testing
make test            # Ejecutar tests
make test-cov        # Tests con cobertura

# Utilidades
make shell-backend   # Shell en backend
make shell-frontend  # Shell en frontend
make clean           # Limpiar contenedores

# Ver todos los comandos
make help
```

## 🗂️ Estructura del Proyecto

```
viltrumflow/
├── backend/                 # FastAPI Backend
│   ├── app/
│   │   ├── routers/        # Endpoints API
│   │   ├── models.py       # Modelos SQLAlchemy
│   │   ├── schemas.py      # Schemas Pydantic
│   │   ├── auth.py         # Autenticación JWT
│   │   ├── database.py     # Configuración DB
│   │   ├── config.py       # Settings
│   │   └── main.py         # App principal
│   ├── alembic/            # Migraciones
│   ├── tests/              # Tests
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/               # Angular Frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── guards/
│   │   │   ├── interceptors/
│   │   │   └── models/
│   │   └── environments/
│   ├── Dockerfile
│   └── nginx.conf
├── nginx/                  # Nginx config
├── scripts/               # Scripts utilidad
├── docker-compose.yml
├── docker-compose.prod.yml
├── Makefile
└── README.md
```

## 🔐 Seguridad

- Autenticación JWT con refresh tokens
- Hash de contraseñas con bcrypt
- CORS configurado correctamente
- Rate limiting en endpoints sensibles
- Headers de seguridad HTTP
- Validación de inputs con Pydantic
- SQL injection prevention con SQLAlchemy
- Variables de entorno para secretos

## 📚 API Documentation

La documentación completa de la API está disponible en:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

### Endpoints principales

```
Authentication
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
GET    /api/v1/auth/me

Users
GET    /api/v1/users
GET    /api/v1/users/{id}
PUT    /api/v1/users/{id}
DELETE /api/v1/users/{id}

Projects
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{id}
PUT    /api/v1/projects/{id}
DELETE /api/v1/projects/{id}

Tasks
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/{id}
PUT    /api/v1/tasks/{id}
DELETE /api/v1/tasks/{id}

Comments
GET    /api/v1/comments
POST   /api/v1/comments
PUT    /api/v1/comments/{id}
DELETE /api/v1/comments/{id}
```

## 🧪 Testing

```bash
# Backend tests
make test
make test-cov

# Frontend tests
docker-compose exec frontend npm test
```

## 🚢 Despliegue en Producción

1. **Configurar variables de entorno de producción**
```bash
cp .env.example .env.prod
# Configurar valores de producción
```

2. **Construir y levantar**
```bash
make build-prod
make up-prod
```

3. **Configurar SSL con Let's Encrypt** (recomendado)
```bash
# Añadir certbot a docker-compose.prod.yml
```

## 🔧 Tecnologías

### Backend
- FastAPI 0.109
- PostgreSQL 16
- SQLAlchemy 2.0
- Alembic (migraciones)
- Redis (caché)
- JWT (autenticación)
- Pydantic (validación)

### Frontend
- Angular 19 (standalone)
- Angular Material
- TypeScript
- RxJS
- TailwindCSS

### DevOps
- Docker & Docker Compose
- Nginx
- GitHub Actions (CI/CD)
- Make

## 📈 Performance

- Rate limiting configurado
- Compresión GZip
- Connection pooling en DB
- Redis para caché
- Índices optimizados en BD
- Lazy loading en frontend

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto está bajo la Licencia MIT. Ver `LICENSE` para más detalles.

## 👥 Autores

- Tu Nombre - [@tu-usuario](https://github.com/tu-usuario)

## 🙏 Agradecimientos

- FastAPI por el excelente framework
- Angular team por Angular 19
- Comunidad open source

---

⭐ Si este proyecto te ha sido útil, considera darle una estrella en GitHub!