"""
Apex Studio Cognitive Planner Engine.
Powered by ApexPhi-Think-14B with autonomous web research and bounded invariant reasoning.
"""

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union
import requests
from pydantic import BaseModel, Field, field_validator

from engine.web_tools import search_web, fetch_page_content

logger = logging.getLogger("apex_studio.planner")


class ApexStep(BaseModel):
    id: int = Field(description="Step sequence number")
    title: str = Field(description="Concise description of the step")
    target_file: str = Field(default="", description="Relative path of file to create or modify")
    action: str = Field(default="create", description="create, modify, delete, or execute")
    invariants: List[str] = Field(default_factory=list, description="Invariant rules that must hold")
    description: str = Field(default="", description="Detailed explanation of what to implement")
    code_specification: Union[str, Dict[str, Any], List[Any]] = Field(
        default="", description="Specific signatures, logic, imports, and algorithm details"
    )
    verification_command: str = Field(default="", description="Command to verify this step passes")
    status: str = Field(default="pending", description="pending, running, completed, failed")
    error: Optional[str] = None

    @field_validator("code_specification", mode="before")
    @classmethod
    def serialize_code_spec(cls, v: Any) -> str:
        if isinstance(v, (dict, list)):
            return json.dumps(v, indent=2)
        return str(v) if v is not None else ""


class ApexPlan(BaseModel):
    feature_name: str
    objective: str
    invariants: List[str] = Field(default_factory=list)
    web_research: List[Dict[str, Any]] = Field(default_factory=list)
    steps: List[ApexStep] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ApexPlanner:
    def __init__(
        self,
        ollama_url: str = "http://localhost:11434",
        model: str = "apex-phi-think-14b",
        workspace_dir: Optional[str] = None
    ):
        self.ollama_url = ollama_url
        self.model = model
        self.workspace_dir = Path(workspace_dir or os.getcwd()).resolve()

    def set_model(self, model: str):
        """Update active planner model."""
        self.model = model
        logger.info("Planner active model switched to: %s", model)

    def _query_ollama(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        json_format: bool = False,
        temperature: float = 0.4,
        num_predict: int = 1200,
        model: Optional[str] = None
    ) -> str:
        """Query local Ollama server running specified thinking model."""
        active_model = model or self.model
        payload: Dict[str, Any] = {
            "model": active_model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
                "top_p": 0.9,
                "min_p": 0.05,
            }
        }
        if system_prompt:
            payload["system"] = system_prompt
        if json_format:
            payload["format"] = "json"

        resp = requests.post(
            f"{self.ollama_url}/api/generate",
            json=payload,
            timeout=120
        )
        resp.raise_for_status()
        return resp.json().get("response", "")

    def conduct_web_research(
        self,
        feature_brief: str,
        progress_cb: Optional[Callable[[str], None]] = None,
        model: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Autonomously determine search queries, search the web, and scrape relevant documentation."""
        active_model = model or self.model
        if progress_cb:
            progress_cb(f"Analyzing feature brief for necessary web research using {active_model}...")

        research_prompt = f"""You are a cognitive architecture planner. Determine what external documentation, library APIs, or technical specs are needed to implement this feature:
Feature: {feature_brief}

Provide 1 to 3 distinct search queries to find the most accurate documentation and API references.
Output format:
QUERY: <search query 1>
QUERY: <search query 2>
QUERY: <search query 3>"""

        raw_queries = self._query_ollama(research_prompt, temperature=0.3, num_predict=200, model=active_model)
        queries = []
        for line in raw_queries.splitlines():
            line = line.strip()
            if line.upper().startswith("QUERY:"):
                q = line[6:].strip().strip('"\'')
                if q:
                    queries.append(q)

        if not queries:
            queries = [feature_brief]

        research_results: List[Dict[str, Any]] = []

        for q in queries[:3]:
            if progress_cb:
                progress_cb(f"Searching web: '{q}'...")
            search_items = search_web(q, max_results=2)
            for item in search_items:
                if not item.get("href"):
                    continue
                if progress_cb:
                    progress_cb(f"Scraping doc: {item.get('title', item['href'])}...")
                page_data = fetch_page_content(item["href"], max_chars=3500)
                research_results.append({
                    "query": q,
                    "title": item.get("title", ""),
                    "url": item.get("href", ""),
                    "snippet": item.get("body", ""),
                    "content_preview": page_data.get("content", "")[:1500] if page_data.get("status") == "success" else item.get("body", "")
                })

        return research_results

    def plan_feature(
        self,
        feature_prompt: str,
        allow_search: bool = True,
        progress_cb: Optional[Callable[[str], None]] = None,
        model: Optional[str] = None,
        thinking_depth: str = "standard"
    ) -> ApexPlan:
        """Synthesize a complete implementation plan using the selected thinking model with optional web research."""
        active_model = model or self.model
        depth_predict = {"fast": 1500, "standard": 2500, "deep": 5000}
        num_predict = depth_predict.get(thinking_depth, 2500)
        research_notes: List[Dict[str, Any]] = []
        if allow_search:
            try:
                research_notes = self.conduct_web_research(feature_prompt, progress_cb, model=active_model)
            except Exception as e:
                logger.error("Web research error: %s", e)
                if progress_cb:
                    progress_cb(f"Web research notice: {e}")

        # Assemble research summary
        research_summary = ""
        if research_notes:
            research_summary = "EXTERNAL WEB RESEARCH FINDINGS:\n"
            for idx, r in enumerate(research_notes, 1):
                research_summary += f"[{idx}] {r.get('title')} ({r.get('url')}):\n{r.get('content_preview')}\n\n"

        # Scan workspace layout (top level files/directories)
        try:
            workspace_files = [
                str(p.relative_to(self.workspace_dir))
                for p in self.workspace_dir.glob("*")
                if not p.name.startswith(".") and p.name != "node_modules"
            ][:20]
            workspace_context = "Workspace existing top-level files:\n" + "\n".join(workspace_files)
        except Exception:
            workspace_context = ""

        system_prompt = """You are ApexPhi-Think, the cognitive architecture planner of Apex Studio.
Your role: Plan software features with mathematical rigor and bounded invariant reasoning.
Rules:
1. Deconstruct the feature into concrete, sequential implementation steps.
2. Every step must have explicit invariant rules (what must remain true).
3. Every step must have a concrete target file, code specification, and verification command.
4. Output MUST be strictly valid JSON conforming to the schema below. No conversational preamble.

Schema:
{
  "feature_name": "Short Name",
  "objective": "Clear description of feature goal",
  "invariants": ["System-wide invariant 1", "System-wide invariant 2"],
  "steps": [
    {
      "id": 1,
      "title": "Step title",
      "target_file": "path/to/target_file.ext",
      "action": "create|modify|execute",
      "invariants": ["Step invariant 1"],
      "description": "What this step does",
      "code_specification": "Explicit functions, classes, arguments, and return types to implement",
      "verification_command": "Command to verify this step (e.g. pytest tests/test_feature.py, python -m py_compile target.py)"
    }
  ]
}"""

        user_prompt = f"""Feature Request:
{feature_prompt}

{workspace_context}

{research_summary}

Synthesize the implementation plan strictly conforming to the JSON schema."""

        if progress_cb:
            progress_cb(f"Synthesizing step-by-step invariant plan using {active_model}...")

        raw_plan = self._query_ollama(
            prompt=user_prompt,
            system_prompt=system_prompt,
            json_format=True,
            temperature=0.3,
            num_predict=num_predict,
            model=active_model
        )

        try:
            plan_dict = json.loads(raw_plan)
        except json.JSONDecodeError:
            # Fallback regex extraction if Ollama output has surrounding tokens
            match = re.search(r"\{.*\}", raw_plan, re.DOTALL)
            if match:
                plan_dict = json.loads(match.group(0))
            else:
                raise ValueError("ApexPhi-Think did not return valid JSON.")

        plan_dict["web_research"] = research_notes
        plan = ApexPlan(**plan_dict)

        # Save plan to workspace
        plan_path = self.workspace_dir / "APEX_PLAN.json"
        with open(plan_path, "w", encoding="utf-8") as f:
            f.write(plan.model_dump_json(indent=2))

        if progress_cb:
            progress_cb(f"Plan created successfully with {len(plan.steps)} steps and saved to APEX_PLAN.json!")

        return plan
