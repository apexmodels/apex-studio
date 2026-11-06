# Apex Studio: Cognitive Invariant AI IDE

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)
[![Models: ApexPhi-14B](https://img.shields.io/badge/Models-ApexPhi--14B-green.svg)](https://huggingface.co/nileshc90/apex-phi-14b)
[![GitHub](https://img.shields.io/badge/GitHub-apex--studio-black.svg)](https://github.com/nileshchakraborty/apex-studio)

**Apex Studio** is a next-generation open-source AI IDE built on top of the Microsoft VS Code (`Code - OSS`) architecture. It decouples software engineering into a **two-stage cognitive pipeline**:
1. **Plan (Cognitive Architecture & Autonomous Web Exploration)**: Powered by `apex-phi-think-14b`, which queries DuckDuckGo, scrapes official documentation and APIs, synthesizes mathematical invariant constraints, and generates an ordered execution DAG (`APEX_PLAN.json`).
2. **Act (Deterministic Code Actuation & Verification)**: Powered by `apex-phi-coder-14b`, which writes production-grade code, enforces AST syntax validation, executes step-specific verification commands, and runs reflexive self-repair loops upon any test failures.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    User([User Feature Request]) --> EngineDaemon[Apex Studio Engine Daemon :8000]
    
    subgraph Cognitive Stage: Plan Mode
        EngineDaemon --> Planner[engine.planner: ApexPlanner]
        Planner --> ThinkModel[apex-phi-think-14b Local Ollama]
        ThinkModel --> QueryGen[Formulate Web Queries]
        QueryGen --> WebSearch[engine.web_tools: DuckDuckGo Search]
        WebSearch --> Scraper[engine.web_tools: Documentation Scraper]
        Scraper --> ResearchSummary[Synthesize Web Research]
        ResearchSummary --> InvariantEngine[Bounded Invariant Reasoner]
        InvariantEngine --> ApexPlan[APEX_PLAN.json Execution DAG]
    end

    subgraph Actuation Stage: Act Mode
        ApexPlan --> Coder[engine.coder: ApexCoder]
        Coder --> CodeModel[apex-phi-coder-14b Local Ollama]
        CodeModel --> ASTCheck{AST Syntax Valid?}
        ASTCheck -- Failed --> ReflexPrompt[Reflex Prompt: Self-Correction]
        ReflexPrompt --> CodeModel
        ASTCheck -- Passed --> WriteFile[Write File to Disk]
        WriteFile --> TestRunner[Run Verification Command]
        TestRunner -- Non-Zero Exit --> ReflexPrompt
        TestRunner -- Passed --> DiffViewer[VS Code Diff Review & Verified Step]
    end

    subgraph IDE Integration
        DiffViewer --> ExtensionUI[extensions/apex-studio: Activity Bar UI]
    end
```

---

## 🚀 Quickstart

### 1. Prerequisites
- **Ollama** running locally with `apex-phi-think-14b` and `apex-phi-coder-14b`:
  ```bash
  ollama list
  # Confirm apex-phi-think-14b and apex-phi-coder-14b are present
  ```
- **Python 3.10+** with dependencies:
  ```bash
  pip install ddgs beautifulsoup4 fastapi uvicorn requests pydantic
  ```
- **Node.js 18+** & `npm`

### 2. Setup Apex Studio
Run the automated bootstrap script:
```bash
./scripts/setup_apex_studio.sh
```

### 3. Launching Apex Studio
Launch the engine daemon and the IDE:
```bash
./scripts/apex-studio.sh
```
Or start the engine daemon independently:
```bash
python3 -m engine.server
```

---

## 🖥️ VS Code / Cursor Extension

Apex Studio includes a dedicated extension located in `extensions/apex-studio`.

### Installation in VS Code / Cursor
```bash
code --install-extension apex-studio.vsix
# or for Cursor:
cursor --install-extension apex-studio.vsix
```

### Features
- **Sidebar Activity Container**: Direct access to Apex Studio in the VS Code Activity Bar.
- **Plan Tab**: Input feature specifications, toggle live DuckDuckGo web research, view real-time cognitive reasoning traces, and preview the generated invariant step DAG.
- **Act Tab**: Step-by-step progress tracking, one-click execution of planned steps with AST validation, live unified diff reviews, and terminal verification feedback.
- **Direct Editor Navigation**: Click on any target file in the plan to open it directly in the editor.

---

## ⌨️ Command Line Interface (CLI)

You can use the full cognitive pipeline directly from the command line:

```bash
# Check status of models and daemon
python3 -m engine.cli status

# Search web for library documentation
python3 -m engine.cli search "fastapi lifespan asynccontextmanager"

# Plan a feature using ApexPhi-Think-14B with autonomous web search
python3 -m engine.cli plan "Add rate-limiting middleware using Redis token-bucket"

# Execute a single step from APEX_PLAN.json
python3 -m engine.cli act --step 1

# Execute all steps sequentially with verification
python3 -m engine.cli act --all

# Launch the FastAPI engine daemon
python3 -m engine.cli serve
```

---

## 🔌 Engine API Endpoints

The Apex Studio backend daemon runs on `http://127.0.0.1:8000`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | `GET` | Health check, connected models, active plan status |
| `/api/search` | `POST` | DuckDuckGo search query execution |
| `/api/scrape` | `POST` | Webpage scraper and markdown extractor |
| `/api/plan` | `POST` | Synthesize feature plan with `apex-phi-think-14b` |
| `/api/plan/current` | `GET` | Retrieve the active plan DAG (`APEX_PLAN.json`) |
| `/api/execute-step` | `POST` | Execute step with `apex-phi-coder-14b` |
| `/api/execute-all` | `POST` | Sequentially execute all pending steps |
| `/api/plan/reset` | `POST` | Clear active plan |

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.
