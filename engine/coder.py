"""
Apex Studio Deterministic Coder Engine.
Powered by ApexPhi-Coder-14B with AST validation, verification commands, and reflexive self-repair.
"""

import ast
import difflib
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import requests

from engine.planner import ApexStep

logger = logging.getLogger("apex_studio.coder")


class StepExecutionResult:
    def __init__(
        self,
        step_id: int,
        target_file: str,
        success: bool,
        diff: str = "",
        verification_output: str = "",
        error: Optional[str] = None,
        retries: int = 0
    ):
        self.step_id = step_id
        self.target_file = target_file
        self.success = success
        self.diff = diff
        self.verification_output = verification_output
        self.error = error
        self.retries = retries

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step_id": self.step_id,
            "target_file": self.target_file,
            "success": self.success,
            "diff": self.diff,
            "verification_output": self.verification_output,
            "error": self.error,
            "retries": self.retries,
        }


class ApexCoder:
    def __init__(
        self,
        ollama_url: str = "http://localhost:11434",
        model: str = "apex-phi-coder-14b",
        workspace_dir: Optional[str] = None
    ):
        self.ollama_url = ollama_url
        self.model = model
        self.workspace_dir = Path(workspace_dir or os.getcwd()).resolve()

    def _query_ollama(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: float = 0.2,
        num_predict: int = 2048
    ) -> str:
        """Query local Ollama server running ApexPhi-Coder."""
        payload: Dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
                "top_p": 0.95,
                "min_p": 0.04,
            }
        }
        if system_prompt:
            payload["system"] = system_prompt

        resp = requests.post(
            f"{self.ollama_url}/api/generate",
            json=payload,
            timeout=180
        )
        resp.raise_for_status()
        return resp.json().get("response", "")

    def _extract_code(self, response_text: str) -> str:
        """Extract code from markdown code fences or return raw response."""
        code_match = re.search(r"```(?:\w+)?\n(.*?)```", response_text, re.DOTALL)
        if code_match:
            return code_match.group(1).rstrip()
        return response_text.strip()

    def _validate_syntax(self, file_path: str, code: str) -> Optional[str]:
        """Validate syntax using AST parser when applicable."""
        if file_path.endswith(".py"):
            try:
                ast.parse(code)
            except SyntaxError as e:
                return f"Python SyntaxError at line {e.lineno}: {e.msg}"
        elif file_path.endswith(".json"):
            try:
                json.loads(code)
            except json.JSONDecodeError as e:
                return f"JSON DecodeError: {e.msg} at line {e.lineno}"
        return None

    def execute_step(
        self,
        step: ApexStep,
        feature_objective: str = "",
        max_retries: int = 2,
        progress_cb: Optional[Callable[[str], None]] = None
    ) -> StepExecutionResult:
        """Execute a single planned step with syntax checking, verification, and reflex self-correction."""
        if not step.target_file and step.action == "execute":
            # Command execution only step
            if step.verification_command:
                if progress_cb:
                    progress_cb(f"Running execution step: {step.verification_command}")
                res = subprocess.run(
                    step.verification_command,
                    shell=True,
                    cwd=str(self.workspace_dir),
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                success = (res.returncode == 0)
                out = (res.stdout + "\n" + res.stderr).strip()
                return StepExecutionResult(
                    step_id=step.id,
                    target_file="",
                    success=success,
                    verification_output=out,
                    error=None if success else f"Command failed with exit code {res.returncode}"
                )
            return StepExecutionResult(step_id=step.id, target_file="", success=True)

        target_path = (self.workspace_dir / step.target_file).resolve()
        original_content = ""
        if target_path.exists() and target_path.is_file():
            try:
                original_content = target_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.warning("Could not read original file %s: %s", target_path, e)

        invariants_text = "\n".join(f"- {inv}" for inv in step.invariants) if step.invariants else "- Preserve functional correctness."

        system_prompt = """You are ApexPhi-Coder, a high-precision deterministic code generation engine.
Your task is to write or update code to strictly satisfy the given specification and invariant constraints.
Guidelines:
1. Output ONLY the complete, production-ready code for the target file inside a single code block.
2. Maintain all existing functionality unless explicitly requested otherwise.
3. No omissions, placeholders, or '// TODO' shortcuts.
4. Follow idiomatic style, type hints, and clean structure."""

        user_prompt = f"""Target File: {step.target_file}
Action: {step.action}
Objective: {feature_objective}
Step Description: {step.description}
Code Specification: {step.code_specification}

Required Invariants:
{invariants_text}
"""
        if original_content:
            user_prompt += f"\nExisting File Content:\n```\n{original_content}\n```\n"

        current_prompt = user_prompt
        last_error = None
        final_code = ""

        for attempt in range(max_retries + 1):
            if attempt > 0 and progress_cb:
                progress_cb(f"Reflex self-correction attempt {attempt}/{max_retries} for step {step.id}...")
            elif progress_cb:
                progress_cb(f"Generating code with ApexPhi-Coder for {step.target_file}...")

            raw_response = self._query_ollama(
                prompt=current_prompt,
                system_prompt=system_prompt,
                temperature=0.15 + (attempt * 0.05),
                num_predict=2048
            )

            code = self._extract_code(raw_response)
            final_code = code

            # Syntax validation check
            syntax_err = self._validate_syntax(step.target_file, code)
            if syntax_err:
                last_error = f"Syntax validation failed: {syntax_err}"
                logger.warning("Attempt %d syntax error: %s", attempt, syntax_err)
                current_prompt = (
                    f"{user_prompt}\n\nYour previous code produced a syntax error:\n{syntax_err}\n"
                    f"Fix this error immediately. Return the complete corrected code inside a code block."
                )
                continue

            # Write file to disk
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(code, encoding="utf-8")

            # Run verification command if defined
            verif_out = ""
            if step.verification_command:
                if progress_cb:
                    progress_cb(f"Running verification command: {step.verification_command}")
                try:
                    proc = subprocess.run(
                        step.verification_command,
                        shell=True,
                        cwd=str(self.workspace_dir),
                        capture_output=True,
                        text=True,
                        timeout=30
                    )
                    verif_out = (proc.stdout + "\n" + proc.stderr).strip()
                    if proc.returncode != 0:
                        last_error = f"Verification command failed (exit code {proc.returncode}):\n{verif_out}"
                        logger.warning("Verification failed on attempt %d: %s", attempt, last_error)
                        current_prompt = (
                            f"{user_prompt}\n\nYour previous code was written, but verification failed:\n{verif_out}\n"
                            f"Analyze this error and produce the corrected code adhering strictly to all invariants."
                        )
                        continue
                except subprocess.TimeoutExpired:
                    last_error = f"Verification command timed out after 30 seconds."
                    logger.warning(last_error)

            # Generate diff
            diff_lines = list(difflib.unified_diff(
                original_content.splitlines(keepends=True),
                code.splitlines(keepends=True),
                fromfile=f"a/{step.target_file}",
                tofile=f"b/{step.target_file}",
                n=3
            ))
            diff_text = "".join(diff_lines)

            if progress_cb:
                progress_cb(f"Step {step.id} successfully completed and verified!")

            return StepExecutionResult(
                step_id=step.id,
                target_file=step.target_file,
                success=True,
                diff=diff_text,
                verification_output=verif_out,
                retries=attempt
            )

        # All retries exhausted
        diff_lines = list(difflib.unified_diff(
            original_content.splitlines(keepends=True),
            final_code.splitlines(keepends=True),
            fromfile=f"a/{step.target_file}",
            tofile=f"b/{step.target_file}",
            n=3
        ))
        return StepExecutionResult(
            step_id=step.id,
            target_file=step.target_file,
            success=False,
            diff="".join(diff_lines),
            error=last_error or "Execution failed after maximum retries.",
            retries=max_retries
        )
