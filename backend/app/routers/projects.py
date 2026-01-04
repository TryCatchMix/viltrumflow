from fastapi import APIRouter

router = APIRouter()

@router.get("/test")
async def test_projects():
    return {"message": "Projects router working"}