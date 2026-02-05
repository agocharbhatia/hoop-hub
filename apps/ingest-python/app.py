from __future__ import annotations

import importlib
import inspect
import os
import re
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, HTTPException
from nba_api.stats.library.http import NBAStatsHTTP
from pydantic import BaseModel, Field

DEFAULT_TIMEOUT_MS = int(os.getenv("NBA_API_TIMEOUT_MS", "30000"))
DEFAULT_PROXY = os.getenv("NBA_API_PROXY", "")


class StatsRequest(BaseModel):
    module: str | None = None
    endpoint: str | None = None
    # Backward-compatible alias for existing Bun payloads.
    params: dict[str, Any] = Field(default_factory=dict)
    # Preferred field for new integrations.
    overrides: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int | None = None
    proxy: str | None = None
    headers: dict[str, str] | None = None


@dataclass
class EndpointMeta:
    module: str
    endpoint: str
    class_name: str
    required_constructor_args: list[str]
    constructor_args: list[str]
    default_parameter_keys: list[str]


class SidecarValidationError(ValueError):
    pass


def _placeholder_for_arg(name: str) -> Any:
    lower = name.lower()
    if "game_id" in lower or lower == "gameid":
        return "0022300001"
    if "season_type" in lower:
        return "Regular Season"
    if lower == "season":
        return "2024-25"
    if "player_id" in lower:
        return "2544"
    if "team_id" in lower:
        return "1610612747"
    if "league_id" in lower:
        return "00"
    if "date" in lower:
        return "2024-10-22"
    if "measure_type" in lower:
        return "Base"
    if "per_mode" in lower:
        return "PerGame"
    if "last_n_games" in lower or "lastngames" in lower:
        return 0
    if "month" in lower:
        return 0
    if "period" in lower:
        return 0
    if "rank" in lower or "plus_minus" in lower or "pace_adjust" in lower:
        return "N"
    return ""


def _load_endpoint_class(module_name: str):
    mod = importlib.import_module(f"nba_api.stats.endpoints.{module_name}")
    classes = [
        obj
        for _, obj in inspect.getmembers(mod, inspect.isclass)
        if obj.__module__ == mod.__name__ and hasattr(obj, "endpoint")
    ]
    if not classes:
        raise SidecarValidationError(f"No endpoint class found for module '{module_name}'")
    return classes[0]


def _required_ctor_args(cls: Any) -> list[str]:
    sig = inspect.signature(cls.__init__)
    required: list[str] = []
    for name, param in sig.parameters.items():
        if name in {"self", "get_request", "proxy", "headers", "timeout"}:
            continue
        if param.default is inspect._empty:
            required.append(name)
    return required


def _constructor_args(cls: Any) -> list[str]:
    sig = inspect.signature(cls.__init__)
    out: list[str] = []
    for name in sig.parameters:
        if name not in {"self", "get_request", "proxy", "headers", "timeout"}:
            out.append(name)
    return out


def _build_ctor_kwargs(cls: Any, overrides: dict[str, Any]) -> tuple[dict[str, Any], set[str]]:
    sig = inspect.signature(cls.__init__)
    kwargs: dict[str, Any] = {"get_request": False}
    consumed: set[str] = set()

    for name, param in sig.parameters.items():
        if name in {"self", "get_request", "proxy", "headers", "timeout"}:
            continue

        if name in overrides:
            kwargs[name] = overrides[name]
            consumed.add(name)
            continue

        if param.default is inspect._empty:
            kwargs[name] = _placeholder_for_arg(name)

    return kwargs, consumed


def _build_meta(module_name: str) -> EndpointMeta:
    cls = _load_endpoint_class(module_name)
    required = _required_ctor_args(cls)
    ctor_args = _constructor_args(cls)

    # Build a dry instance to inspect canonical parameter keys emitted by nba_api.
    kwargs, _ = _build_ctor_kwargs(cls, {})
    instance = cls(**kwargs)
    param_keys = sorted(list((getattr(instance, "parameters", {}) or {}).keys()))

    endpoint_name = str(getattr(cls, "endpoint", module_name))
    return EndpointMeta(
        module=module_name,
        endpoint=endpoint_name,
        class_name=cls.__name__,
        required_constructor_args=required,
        constructor_args=ctor_args,
        default_parameter_keys=param_keys,
    )


def _classify_error(exc: Exception) -> tuple[str, bool, int | None]:
    message = str(exc)
    lower = message.lower()

    if "invalidresponse" in lower and "json" in lower:
        return "invalid_json", True, None

    if "timed out" in lower or "timeout" in lower or "readtimeout" in lower:
        return "timeout", True, None

    if any(token in lower for token in ["connection", "name resolution", "dns", "refused", "proxy"]):
        return "network", True, None

    if any(token in lower for token in ["parameter", "required positional argument", "unexpected keyword"]):
        return "param_validation", False, None

    status_match = re.search(r"\b(4\d\d|5\d\d)\b", message)
    http_status = int(status_match.group(1)) if status_match else None
    retryable = http_status is None or http_status >= 500
    return "nba_error", retryable, http_status


def _resolve_module(module: str | None, endpoint: str | None) -> str:
    if module:
        if module not in MODULE_TO_META:
            raise SidecarValidationError(f"Unknown module '{module}'")
        return module

    if endpoint:
        resolved = ENDPOINT_TO_MODULE.get(endpoint.lower())
        if not resolved:
            raise SidecarValidationError(f"Unknown endpoint '{endpoint}'")
        return resolved

    raise SidecarValidationError("Either 'module' or 'endpoint' must be provided")


def _merge_overrides(req: StatsRequest) -> dict[str, Any]:
    merged = dict(req.params)
    merged.update(req.overrides)
    return merged


def _run_stats_request(module_name: str, req: StatsRequest) -> tuple[dict[str, Any], EndpointMeta, int]:
    meta = MODULE_TO_META[module_name]
    cls = _load_endpoint_class(module_name)

    merged_overrides = _merge_overrides(req)
    ctor_kwargs, consumed = _build_ctor_kwargs(cls, merged_overrides)
    instance = cls(**ctor_kwargs)

    parameters = dict((getattr(instance, "parameters", {}) or {}))
    key_lookup = {key.lower(): key for key in parameters.keys()}

    unknown_keys: list[str] = []
    for key, value in merged_overrides.items():
        if key in consumed:
            continue
        if key in parameters:
            parameters[key] = value
            continue

        lowered = key.lower()
        if lowered in key_lookup:
            parameters[key_lookup[lowered]] = value
            continue

        # Allow passing constructor-style names as overrides even if omitted from ctor kwargs.
        if key in meta.constructor_args:
            continue

        unknown_keys.append(key)

    if unknown_keys:
        raise SidecarValidationError(
            f"Unknown override keys for module '{module_name}': {', '.join(sorted(unknown_keys))}"
        )

    timeout_ms = req.timeout_ms or DEFAULT_TIMEOUT_MS
    timeout_seconds = max(int(timeout_ms), 1000) / 1000.0
    proxy = req.proxy if req.proxy not in (None, "") else (DEFAULT_PROXY or None)

    response = NBAStatsHTTP().send_api_request(
        endpoint=meta.endpoint,
        parameters=parameters,
        proxy=proxy,
        headers=req.headers,
        timeout=timeout_seconds,
        raise_exception_on_error=True,
    )

    payload = response.get_dict()
    response_bytes = len(str(payload).encode("utf-8"))
    return payload, meta, response_bytes


# Build endpoint inventory once at startup.
try:
    import nba_api.stats.endpoints as stats_endpoints

    _module_names = sorted(list(getattr(stats_endpoints, "__all__", [])))
except Exception:
    _module_names = []

MODULE_TO_META: dict[str, EndpointMeta] = {}
ENDPOINT_TO_MODULE: dict[str, str] = {}
INVENTORY_ERRORS: list[dict[str, str]] = []

for _module in _module_names:
    try:
        _meta = _build_meta(_module)
        MODULE_TO_META[_module] = _meta
        ENDPOINT_TO_MODULE[_meta.endpoint.lower()] = _module
    except Exception as exc:
        INVENTORY_ERRORS.append({"module": _module, "error": str(exc)})


app = FastAPI()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "inventory_count": len(MODULE_TO_META),
        "inventory_errors": len(INVENTORY_ERRORS),
    }


@app.get("/endpoints")
def endpoints() -> dict[str, Any]:
    return {
        "count": len(MODULE_TO_META),
        "endpoints": [
            {
                "module": meta.module,
                "endpoint": meta.endpoint,
                "class_name": meta.class_name,
                "required_constructor_args": meta.required_constructor_args,
                "constructor_args": meta.constructor_args,
                "default_parameter_keys": meta.default_parameter_keys,
            }
            for meta in sorted(MODULE_TO_META.values(), key=lambda item: item.module)
        ],
        "errors": INVENTORY_ERRORS,
    }


@app.post("/stats")
def stats(req: StatsRequest) -> dict[str, Any]:
    try:
        module_name = _resolve_module(req.module, req.endpoint)
        payload, meta, response_bytes = _run_stats_request(module_name, req)
        return {
            "module": module_name,
            "endpoint": meta.endpoint,
            "response_bytes": response_bytes,
            "payload": payload,
        }
    except SidecarValidationError as exc:
        error_type, retryable, http_status = _classify_error(exc)
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": error_type,
                "http_status": http_status,
                "message": str(exc),
                "module": req.module,
                "endpoint": req.endpoint,
                "retryable": retryable,
            },
        )
    except Exception as exc:
        error_type, retryable, http_status = _classify_error(exc)
        raise HTTPException(
            status_code=502,
            detail={
                "error_type": error_type,
                "http_status": http_status,
                "message": str(exc),
                "module": req.module,
                "endpoint": req.endpoint,
                "retryable": retryable,
            },
        )
