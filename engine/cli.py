"""
Apex Studio Command Line Interface.
Allows full terminal-based interaction with multi-model switching (Phi, Mistral, Qwen, DeepSeek, Codestral).
"""

import argparse
import json
import sys
from pathlib import Path
import requests

from engine.planner import ApexPlanner
from engine.coder import ApexCoder
from engine.web_tools import search_web
from engine.server import start as start_server, CONFIG_FILE, fetch_ollama_models


def print_banner():
    banner = r"""
    ========================================================
       ___    ____  _______  __   _____ _____ _   _ ____ ___ ___  
      /   \  |  _ \| ____\ \/ /  / ____|_   _| | | |  _ \_ _/ _ \ 
     / /_\ \ | |_) |  _|  \  /   \___ \  | | | | | | | | | | | | |
    /  _ _  \|  __/| |___ /  \    ___) | | | | |_| | |_| | | |_| |
    \_/   \_/|_|   |_____/_/\_\  |____/  |_|  \___/|____/___\___/ 
      Cognitive Invariant IDE Engine (Multi-Model Switcher)
    ========================================================
    """
    print(banner)


def load_active_config():
    think_m = "apex-phi-think-14b"
    coder_m = "apex-phi-coder-14b"
    if CONFIG_FILE.exists():
        try:
            cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            think_m = cfg.get("think_model", think_m)
            coder_m = cfg.get("coder_model", coder_m)
        except Exception:
            pass
    return think_m, coder_m


def save_active_config(think_m: str, coder_m: str):
    cfg = {"think_model": think_m, "coder_model": coder_m}
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def cmd_status(args):
    think_m, coder_m = load_active_config()
    planner = ApexPlanner(model=think_m)
    print("Checking Ollama backend at:", planner.ollama_url)
    try:
        models = fetch_ollama_models()
        print("Connected to Ollama successfully!")
        print("\nAvailable Models in Ollama:")
        for m in models:
            tag = ""
            if m == think_m:
                tag += " [ACTIVE PLANNER]"
            if m == coder_m:
                tag += " [ACTIVE CODER]"
            print(f"  * {m}{tag}")
        print(f"\nActive Think Model : {think_m}")
        print(f"Active Coder Model : {coder_m}")
    except Exception as e:
        print(f"Error connecting to Ollama: {e}")


def cmd_models(args):
    think_m, coder_m = load_active_config()
    models = fetch_ollama_models()
    print("\n--- APEX STUDIO MODEL REGISTRY ---")
    print(f"Active Planner Model : {think_m}")
    print(f"Active Coder Model   : {coder_m}\n")
    print("Available Models:")
    for m in models:
        prefix = " "
        if m == think_m and m == coder_m:
            prefix = "★ [THINK+CODE]"
        elif m == think_m:
            prefix = "🧠 [THINK]"
        elif m == coder_m:
            prefix = "⚡ [CODE] "
        print(f"  {prefix.ljust(15)} {m}")

    print("\nPreset Model Suites:")
    print("  1. phi     -> apex-phi-think-14b     + apex-phi-coder-14b")
    print("  2. mistral -> apex-mistral-think-22b + apex-mistral-coder-22b")
    print("  3. qwen    -> apex-think-14b         + apex-coder-14b")
    print("\nTo switch suites or models:")
    print("  python -m engine.cli set-model --suite mistral")
    print("  python -m engine.cli set-model --think apex-think-14b --coder apex-coder-14b\n")


def cmd_set_model(args):
    suites = {
        "phi": ("apex-phi-think-14b", "apex-phi-coder-14b"),
        "mistral": ("apex-mistral-think-22b", "apex-mistral-coder-22b"),
        "qwen": ("apex-think-14b", "apex-coder-14b"),
    }
    think_m, coder_m = load_active_config()

    if args.suite:
        suite_key = args.suite.lower()
        if suite_key not in suites:
            print(f"Unknown suite '{args.suite}'. Available: phi, mistral, qwen")
            sys.exit(1)
        think_m, coder_m = suites[suite_key]
        print(f"Applied preset suite '{args.suite.upper()}':")
    else:
        if args.think:
            think_m = args.think
        if args.coder:
            coder_m = args.coder

    save_active_config(think_m, coder_m)
    print(f"  ✓ Active Planner Model: {think_m}")
    print(f"  ✓ Active Coder Model  : {coder_m}")
    print("Configuration saved to APEX_CONFIG.json.")


def cmd_search(args):
    print(f"Searching web for: '{args.query}' (max_results={args.limit})...\n")
    results = search_web(args.query, max_results=args.limit)
    for idx, item in enumerate(results, 1):
        print(f"[{idx}] {item['title']}")
        print(f"    URL: {item['href']}")
        print(f"    Snippet: {item['body']}\n")


def cmd_plan(args):
    default_think, _ = load_active_config()
    think_model = args.think_model or default_think

    print(f"\n--- APEX STUDIO PLANNER ({think_model}) ---")
    print(f"Feature: {args.feature}")
    print(f"Web Search Enabled: {not args.no_search}\n")

    planner = ApexPlanner(model=think_model)
    plan = planner.plan_feature(
        feature_prompt=args.feature,
        allow_search=(not args.no_search),
        progress_cb=lambda msg: print(f"  [Cognition] {msg}"),
        model=think_model
    )

    print("\n" + "="*50)
    print(f"PLAN GENERATED: {plan.feature_name}")
    print(f"Objective: {plan.objective}")
    print("Invariants:")
    for inv in plan.invariants:
        print(f"  * {inv}")
    print(f"\nTotal Steps: {len(plan.steps)}")
    for s in plan.steps:
        print(f"  [{s.id}] {s.title} -> {s.target_file} ({s.action})")
        if s.verification_command:
            print(f"      Verify: {s.verification_command}")
    print("="*50)
    print("Plan saved to APEX_PLAN.json. Run `python -m engine.cli act --all` to execute.\n")


def cmd_act(args):
    _, default_coder = load_active_config()
    coder_model = args.coder_model or default_coder

    print(f"\n--- APEX STUDIO CODER ({coder_model}) ---")
    plan_file = Path("APEX_PLAN.json")
    if not plan_file.exists():
        print("Error: APEX_PLAN.json not found. Run `python -m engine.cli plan '<feature>'` first.")
        sys.exit(1)

    plan_data = json.loads(plan_file.read_text(encoding="utf-8"))
    coder = ApexCoder(model=coder_model)

    if args.step:
        steps_to_run = [s for s in plan_data["steps"] if s["id"] == args.step]
        if not steps_to_run:
            print(f"Error: Step ID {args.step} not found in APEX_PLAN.json.")
            sys.exit(1)
    else:
        steps_to_run = plan_data["steps"]

    for step_dict in steps_to_run:
        from engine.planner import ApexStep
        step = ApexStep(**step_dict)
        print(f"\nExecuting Step [{step.id}]: {step.title} -> {step.target_file} using {coder_model}")
        res = coder.execute_step(
            step=step,
            feature_objective=plan_data.get("objective", ""),
            progress_cb=lambda msg: print(f"  [Code] {msg}"),
            model=coder_model
        )
        if res.success:
            print(f"Step [{step.id}] SUCCESS!")
            if res.diff:
                print("--- Diff applied ---")
                print(res.diff[:600] + ("..." if len(res.diff) > 600 else ""))
            step_dict["status"] = "completed"
        else:
            print(f"Step [{step.id}] FAILED: {res.error}")
            step_dict["status"] = "failed"
            step_dict["error"] = res.error
            break

    plan_file.write_text(json.dumps(plan_data, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Apex Studio CLI")
    subparsers = parser.add_subparsers(dest="command")

    # status
    subparsers.add_parser("status", help="Check status of models and daemon")

    # models
    subparsers.add_parser("models", help="List available Ollama models and suites")

    # set-model
    sm_p = subparsers.add_parser("set-model", help="Switch default Planner and Coder models")
    sm_p.add_argument("--suite", choices=["phi", "mistral", "qwen"], help="Preset suite")
    sm_p.add_argument("--think", help="Specific think/planner model name")
    sm_p.add_argument("--coder", help="Specific coder/actuator model name")

    # search
    search_p = subparsers.add_parser("search", help="Execute DuckDuckGo search")
    search_p.add_argument("query", help="Query string")
    search_p.add_argument("--limit", type=int, default=3, help="Max results")

    # plan
    plan_p = subparsers.add_parser("plan", help="Plan a feature using chosen thinking model")
    plan_p.add_argument("feature", help="Feature prompt or description")
    plan_p.add_argument("--think-model", help="Override planner model")
    plan_p.add_argument("--no-search", action="store_true", help="Disable web search")

    # act
    act_p = subparsers.add_parser("act", help="Implement plan using chosen coder model")
    act_p.add_argument("--step", type=int, help="Execute single step ID")
    act_p.add_argument("--all", action="store_true", help="Execute all steps")
    act_p.add_argument("--coder-model", help="Override coder model")

    # serve
    subparsers.add_parser("serve", help="Start FastAPI daemon")

    args = parser.parse_args()
    if not args.command:
        print_banner()
        parser.print_help()
        sys.exit(0)

    if args.command == "status":
        cmd_status(args)
    elif args.command == "models":
        cmd_models(args)
    elif args.command == "set-model":
        cmd_set_model(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "plan":
        cmd_plan(args)
    elif args.command == "act":
        cmd_act(args)
    elif args.command == "serve":
        start_server()


if __name__ == "__main__":
    main()
