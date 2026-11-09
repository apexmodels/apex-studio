"""
Apex Studio Daemon API Server.
Bridges VS Code Extension, Web UI, and CLI with the multi-model Apex engine.
Allows dynamic switching between any Ollama models (ApexPhi, ApexMistral, ApexQwen, DeepSeek, Codestral, etc.).
"""

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional
import requests
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine.planner import ApexPlan, ApexPlanner, ApexStep
from engine.coder import ApexCoder, StepExecutionResult
from engine.web_tools import search_web, fetch_page_content

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("apex_studio.server")

app = FastAPI(title="Apex Studio Engine", version="1.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKSPACE_DIR = Path(os.environ.get("APEX_WORKSPACE", os.getcwd())).resolve()
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
CONFIG_FILE = WORKSPACE_DIR / "APEX_CONFIG.json"

# Default Model Selection
THINK_MODEL = os.environ.get("APEX_THINK_MODEL", "apex-phi-think-14b")
CODER_MODEL = os.environ.get("APEX_CODER_MODEL", "apex-phi-coder-14b")

# Load persisted configuration if exists
if CONFIG_FILE.exists():
    try:
        saved_cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        if "think_model" in saved_cfg:
            THINK_MODEL = saved_cfg["think_model"]
        if "coder_model" in saved_cfg:
            CODER_MODEL = saved_cfg["coder_model"]
        logger.info("Loaded persisted model configuration: think=%s, coder=%s", THINK_MODEL, CODER_MODEL)
    except Exception as e:
        logger.warning("Failed to load APEX_CONFIG.json: %s", e)

planner = ApexPlanner(ollama_url=OLLAMA_URL, model=THINK_MODEL, workspace_dir=str(WORKSPACE_DIR))
coder = ApexCoder(ollama_url=OLLAMA_URL, model=CODER_MODEL, workspace_dir=str(WORKSPACE_DIR))

# In-memory plan cache
current_plan: Optional[ApexPlan] = None
execution_logs: List[str] = []


def add_log(msg: str):
    logger.info(msg)
    execution_logs.append(msg)
    if len(execution_logs) > 200:
        execution_logs.pop(0)


def save_config():
    try:
        cfg = {
            "think_model": THINK_MODEL,
            "coder_model": CODER_MODEL
        }
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning("Could not persist APEX_CONFIG.json: %s", e)


def fetch_ollama_models() -> List[str]:
    """Retrieve all available models installed in Ollama."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        if resp.status_code == 200:
            return [m["name"].split(":")[0] if m["name"].endswith(":latest") else m["name"] for m in resp.json().get("models", [])]
    except Exception as e:
        logger.warning("Could not reach Ollama: %s", e)
    return []


class PlanRequest(BaseModel):
    prompt: str
    allow_search: bool = True
    think_model: Optional[str] = None
    thinking_depth: Optional[str] = "standard"


class VoiceSpeakRequest(BaseModel):
    text: str
    voice: Optional[str] = "Samantha"
    rate: Optional[int] = 190


class ExecuteStepRequest(BaseModel):
    step_id: int
    coder_model: Optional[str] = None


class ExecuteAllRequest(BaseModel):
    coder_model: Optional[str] = None


class SearchRequest(BaseModel):
    query: str
    max_results: int = 5


class ScrapeRequest(BaseModel):
    url: str
    max_chars: int = 5000


class ModelSelectRequest(BaseModel):
    think_model: Optional[str] = None
    coder_model: Optional[str] = None


@app.get("/health")
@app.get("/api/status")
def get_status():
    available_models = fetch_ollama_models()
    ollama_ok = len(available_models) > 0

    return {
        "status": "online",
        "workspace": str(WORKSPACE_DIR),
        "ollama_connected": ollama_ok,
        "think_model": THINK_MODEL,
        "coder_model": CODER_MODEL,
        "think_model_ready": any(THINK_MODEL in m for m in available_models),
        "coder_model_ready": any(CODER_MODEL in m for m in available_models),
        "available_models": available_models,
        "has_active_plan": current_plan is not None,
        "total_steps": len(current_plan.steps) if current_plan else 0,
        "recent_logs": execution_logs[-10:]
    }


@app.get("/api/models")
def get_models():
    """List all available models in Ollama with recommendations and presets."""
    all_models = fetch_ollama_models()
    
    # Categorize recommended models
    think_candidates = [m for m in all_models if "think" in m.lower() or "r1" in m.lower()]
    coder_candidates = [m for m in all_models if "coder" in m.lower() or "code" in m.lower()]
    
    # Suites
    suites = [
        {
            "id": "phi",
            "name": "Apex Phi Suite (14B)",
            "think_model": "apex-phi-think-14b",
            "coder_model": "apex-phi-coder-14b",
            "description": "Optimized Phi-4 based reasoning and coding duo."
        },
        {
            "id": "mistral",
            "name": "Apex Mistral Suite (22B)",
            "think_model": "apex-mistral-think-22b",
            "coder_model": "apex-mistral-coder-22b",
            "description": "High-capacity Mistral NeMo 22B architecture."
        },
        {
            "id": "qwen",
            "name": "Apex Qwen Suite (14B)",
            "think_model": "apex-think-14b",
            "coder_model": "apex-coder-14b",
            "description": "Compact Invariant Distilled Qwen-2.5 14B."
        }
    ]

    return {
        "active_think_model": THINK_MODEL,
        "active_coder_model": CODER_MODEL,
        "all_models": all_models,
        "recommended_think_models": think_candidates or all_models,
        "recommended_coder_models": coder_candidates or all_models,
        "suites": suites
    }


@app.post("/api/models/select")
def select_models(req: ModelSelectRequest):
    """Switch active planner and/or coder models dynamically."""
    global THINK_MODEL, CODER_MODEL
    updated = False

    if req.think_model:
        THINK_MODEL = req.think_model
        planner.set_model(THINK_MODEL)
        add_log(f"Switched active Planner Model to: {THINK_MODEL}")
        updated = True

    if req.coder_model:
        CODER_MODEL = req.coder_model
        coder.set_model(CODER_MODEL)
        add_log(f"Switched active Coder Model to: {CODER_MODEL}")
        updated = True

    if updated:
        save_config()

    return {
        "status": "success",
        "active_think_model": THINK_MODEL,
        "active_coder_model": CODER_MODEL
    }


@app.post("/api/search")
def api_search(req: SearchRequest):
    return {"query": req.query, "results": search_web(req.query, req.max_results)}


@app.post("/api/scrape")
def api_scrape(req: ScrapeRequest):
    return fetch_page_content(req.url, req.max_chars)


@app.post("/api/plan")
def api_plan_feature(req: PlanRequest):
    global current_plan
    model_to_use = req.think_model or THINK_MODEL
    depth = req.thinking_depth or "standard"
    add_log(f"Received plan request using {model_to_use} [depth={depth}]: '{req.prompt}' (search={req.allow_search})")
    try:
        plan = planner.plan_feature(
            feature_prompt=req.prompt,
            allow_search=req.allow_search,
            progress_cb=add_log,
            model=model_to_use,
            thinking_depth=depth
        )
        current_plan = plan
        return {"status": "success", "plan": plan.model_dump(), "model_used": model_to_use, "thinking_depth": depth}
    except Exception as e:
        logger.exception("Planning failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/voice/voices")
def get_voices():
    """List macOS say voices."""
    voices = []
    try:
        res = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, check=True)
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split(maxsplit=2)
            if len(parts) >= 2:
                voices.append({"name": parts[0], "lang": parts[1]})
    except Exception as e:
        logger.warning("Could not query voices: %s", e)
        voices = [{"name": "Samantha", "lang": "en_US"}, {"name": "Alex", "lang": "en_US"}]
    return {"voices": voices}


_active_tts = None


@app.post("/api/voice/speak")
def voice_speak(req: VoiceSpeakRequest):
    """Speak text using macOS say command."""
    global _active_tts
    if _active_tts and _active_tts.poll() is None:
        try:
            _active_tts.terminate()
        except Exception:
            pass

    # Clean text
    text = req.text
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    text = re.sub(r"```[\s\S]*?```", " Code block omitted. ", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"^#+\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[\*_~]", "", text).strip()

    if not text:
        return {"status": "skipped", "message": "No speakable text"}

    try:
        cmd = ["say"]
        if req.voice:
            cmd.extend(["-v", req.voice])
        if req.rate:
            cmd.extend(["-r", str(req.rate)])
        cmd.append(text)
        _active_tts = subprocess.Popen(cmd)
        return {"status": "speaking", "voice": req.voice}
    except Exception as e:
        logger.error("TTS error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/voice/stop")
def voice_stop():
    global _active_tts
    if _active_tts and _active_tts.poll() is None:
        try:
            _active_tts.terminate()
            return {"status": "stopped"}
        except Exception:
            pass
    return {"status": "idle"}


@app.get("/api/plan/current")
def api_get_current_plan():
    global current_plan
    if not current_plan:
        plan_file = WORKSPACE_DIR / "APEX_PLAN.json"
        if plan_file.exists():
            try:
                data = json.loads(plan_file.read_text(encoding="utf-8"))
                current_plan = ApexPlan(**data)
            except Exception as e:
                logger.warning("Could not load APEX_PLAN.json: %s", e)
    if not current_plan:
        return {"has_plan": False, "plan": None}
    return {"has_plan": True, "plan": current_plan.model_dump()}


@app.post("/api/execute-step")
def api_execute_step(req: ExecuteStepRequest):
    global current_plan
    if not current_plan:
        api_get_current_plan()
    if not current_plan:
        raise HTTPException(status_code=400, detail="No active plan found. Please create a plan first.")

    target_step: Optional[ApexStep] = None
    for s in current_plan.steps:
        if s.id == req.step_id:
            target_step = s
            break

    if not target_step:
        raise HTTPException(status_code=404, detail=f"Step ID {req.step_id} not found in plan.")

    model_to_use = req.coder_model or CODER_MODEL
    add_log(f"Executing step {target_step.id} using {model_to_use}: {target_step.title} -> {target_step.target_file}")
    target_step.status = "running"

    result = coder.execute_step(
        step=target_step,
        feature_objective=current_plan.objective,
        progress_cb=add_log,
        model=model_to_use
    )

    target_step.status = "completed" if result.success else "failed"
    target_step.error = result.error

    # Persist updated plan status
    plan_file = WORKSPACE_DIR / "APEX_PLAN.json"
    plan_file.write_text(current_plan.model_dump_json(indent=2), encoding="utf-8")

    return {
        "status": "success" if result.success else "error",
        "result": result.to_dict(),
        "step": target_step.model_dump(),
        "model_used": model_to_use
    }


@app.post("/api/execute-all")
def api_execute_all(req: Optional[ExecuteAllRequest] = None):
    global current_plan
    if not current_plan:
        api_get_current_plan()
    if not current_plan:
        raise HTTPException(status_code=400, detail="No active plan found.")

    model_to_use = (req.coder_model if req else None) or CODER_MODEL
    results = []
    for step in current_plan.steps:
        if step.status == "completed":
            continue
        add_log(f"Auto-executing step {step.id} / {len(current_plan.steps)} using {model_to_use}: {step.title}")
        step.status = "running"
        res = coder.execute_step(step, current_plan.objective, progress_cb=add_log, model=model_to_use)
        step.status = "completed" if res.success else "failed"
        step.error = res.error
        results.append(res.to_dict())
        if not res.success:
            add_log(f"Execution halted on step {step.id} due to failure.")
            break

    plan_file = WORKSPACE_DIR / "APEX_PLAN.json"
    plan_file.write_text(current_plan.model_dump_json(indent=2), encoding="utf-8")

    return {
        "status": "completed",
        "results": results,
        "plan": current_plan.model_dump(),
        "model_used": model_to_use
    }


@app.post("/api/plan/reset")
def api_reset_plan():
    global current_plan
    current_plan = None
    plan_file = WORKSPACE_DIR / "APEX_PLAN.json"
    if plan_file.exists():
        plan_file.unlink()
    add_log("Active plan reset.")
    return {"status": "reset"}


def start():
    port = int(os.environ.get("APEX_PORT", 8000))
    host = os.environ.get("APEX_HOST", "127.0.0.1")
    logger.info("Starting Apex Studio Engine Daemon on http://%s:%d", host, port)
    uvicorn.run("engine.server:app", host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    start()
