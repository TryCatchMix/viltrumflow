from backend.app.database import Base, engine
from app.models import User, Project, Task

Base.metadata.create_all(bind=engine)
print("Database tables created")