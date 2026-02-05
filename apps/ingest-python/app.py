from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from nba_api.stats.library.http import NBAStatsHTTP

DEFAULT_TIMEOUT_MS = int(os.getenv("NBA_API_TIMEOUT_MS", "30000"))
DEFAULT_PROXY = os.getenv("NBA_API_PROXY", "")


class StatsRequest(BaseModel):
    endpoint: str
    params: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int | None = None
    proxy: str | None = None
    headers: dict[str, str] | None = None


app = FastAPI()


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/stats")
def stats(req: StatsRequest) -> dict[str, Any]:
    timeout_ms = req.timeout_ms or DEFAULT_TIMEOUT_MS
    timeout = max(int(timeout_ms), 1000) / 1000.0
    proxy = req.proxy if req.proxy not in (None, "") else (DEFAULT_PROXY or None)
    headers = req.headers if req.headers else None

    try:
        http = NBAStatsHTTP()
        response = http.send_api_request(
            endpoint=req.endpoint,
            parameters=req.params,
            proxy=proxy,
            headers=headers,
            timeout=timeout,
            raise_exception_on_error=True,
        )
        return response.get_dict()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"NBA_API_ERROR: {exc}")
