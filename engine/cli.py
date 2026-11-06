"""
Apex Studio Command Line Interface.
Allows full terminal-based interaction with ApexPhi-Think and ApexPhi-Coder.
"""

import argparse
import json
import sys
from pathlib import Path

from engine.planner import ApexPlanner
from engine.coder import ApexCoder
from engine.web_tools import search_web, fetch_page_content
from engine.server import start as start_server


def print_banner():
    banner = r"""
    ========================================================
       ___    ____  _______  __   _____ _____ _   _ ____ ___ ___  
      /   \  |  _ \| ____\ \/ /  / ____|_   _| | | |  _ \_ _/ _ \ 
     / /_\ \ | |_) |  _|  \  /   \___ \  | | | | | | | | | | | | |
    /  _ _  \|  __/| |___ /  \    ___) | | | | |_| | |_| | | |_| |
    \_/   \_/|_|   |_____/_/\_\  |____/  |_|  \___/|____/___\___/ 
      Cognitive Invariant IDE Engine (ApexPhi Think & Code)
    ========================================================
    """
    print(banner)


def cmd_status(args):
    planner = ApexPlanner()
    print("Checking Ollama backend at:", planner.ollama_url)
    try:
        import requests
        r = requests.get(f"{planner.ollama_url}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        print("Connected to Ollama successfully!")
        print("\nAvailable Apex Models:")
        for m in models:
            if "apex" in m.lower():
                print(f"  * {m}")
        print(f"\nActive Think Model: {planner.model}")
        print(f"Active Coder Model: apex-phi-coder-14b")
    except Exception as e:
        print(f"Error connecting to Ollama: {e}")


def cmd_search(args):
    print(f"Searching web for: '{args.query}' (max_results={args.limit})...\n")
    results = search_web(args.query, max_results=args.limit)
    for idx, item in enumerate(results, 1):
        print(f"[{idx}] {item['title']}")
        print(f"    URL: {item['href']}")
        print(f"    Snippet: {item['body']}\n")


def cmd_plan(args):
    print(f"\n--- APEX STUDIO PLANNER (ApexPhi-Think-14B) ---")
    print(f"Feature: {args.feature}")
    print(f"Web Search Enabled: {not args.no_search}\n")

    planner = ApexPlanner()
    plan = planner.plan_feature(
        feature_prompt=args.feature,
        allow_search=(not args.no_search),
        progress_cb=lambda msg: print(f"  [Cognition] {msg}")
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
    print("\n--- APEX STUDIO CODER (ApexPhi-Coder-14B) ---")
    plan_file = Path("APEX_PLAN.json")
    if not plan_file.exists():
        print("Error: APEX_PLAN.json not found. Run `python -m engine.cli plan '<feature>'` first.")
        sys.exit(1)

    plan_data = json.loads(plan_file.read_text(encoding="utf-8"))
    coder = ApexCoder()

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
        print(f"\nExecuting Step [{step.id}]: {step.title} -> {step.target_file}")
        res = coder.execute_step(
            step=step,
            feature_objective=plan_data.get("objective", ""),
            progress_cb=lambda msg: print(f"  [Code] {msg}")
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

    # search
    search_p = subparsers.add_parser("search", help="Execute DuckDuckGo search")
    search_p.add_argument("query", help="Query string")
    search_p.add_argument("--limit", type=int, default=3, help="Max results")

    # plan
    plan_p = subparsers.add_parser("plan", help="Plan a feature using ApexPhi-Think-14B")
    plan_p.add_argument("feature", help="Feature prompt or description")
    plan_p.add_argument("--no-search", action="store_true", help="Disable web search")

    # act
    act_p = subparsers.add_parser("act", help="Implement plan using ApexPhi-Coder-14b")
    act_p.add_argument("--step", type=int, help="Execute single step ID")
    act_p.add_argument("--all", action="store_true", help="Execute all steps")

    # serve
    subparsers.add_parser("serve", help="Start FastAPI daemon")

    args = parser.parse_args()
    if not args.command:
        print_banner()
        parser.print_help()
        sys.exit(0)

    if args.command == "status":
        cmd_status(args)
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
