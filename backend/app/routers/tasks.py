from fastapi import APIRouter

router = APIRouter()

@router.get("/test")
async def test_tasks():
    return {"message": "Tasks router working"}