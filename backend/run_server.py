"""
WeighGuard FastAPI Server Runner.
Run with: python -m backend.run_server or python backend/run_server.py
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8001, reload=True)
