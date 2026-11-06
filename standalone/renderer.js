// Apex Studio Standalone Renderer
const API_BASE = 'http://127.0.0.1:8000';

let editor = null;
let currentWorkspace = '';
let openTabs = []; // { path, name, language, isDirty }
let activeTabPath = null;
let activeThinkModel = 'apex-phi-think-14b';
let activeCoderModel = 'apex-phi-coder-14b';
let currentPlan = null;

// Initialize App
window.addEventListener('DOMContentLoaded', async () => {
    initMonaco();
    setupMenuListeners();
    await loadInitialWorkspace();
    checkDaemonStatus();
    setInterval(checkDaemonStatus, 15000);
});

// Monaco Setup
function initMonaco() {
    if (typeof require !== 'undefined' && require.config) {
        require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
        require(['vs/editor/editor.main'], function () {
            editor = monaco.editor.create(document.getElementById('monacoViewport'), {
                value: `# Welcome to Apex Studio (Standalone IDE)\n# Cognitive AI IDE powered by ApexPhi-Think & ApexPhi-Coder\n\nprint("Hello, Apex Studio!")\n`,
                language: 'python',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 13,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                tabSize: 4
            });

            editor.onDidChangeCursorPosition((e) => {
                const pos = e.position;
                document.getElementById('statusCursorPos').textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
            });

            editor.onDidChangeModelContent(() => {
                if (activeTabPath) {
                    const tab = openTabs.find(t => t.path === activeTabPath);
                    if (tab && !tab.isDirty) {
                        tab.isDirty = true;
                        renderTabs();
                    }
                }
            });

            window.addEventListener('resize', () => editor.layout());
        });
    }
}

// Workspace & File Tree
async function loadInitialWorkspace() {
    currentWorkspace = await window.apexApi.getWorkspacePath();
    const wsName = currentWorkspace.split('/').pop() || 'Workspace';
    document.getElementById('workspaceName').textContent = wsName;
    refreshFileTree();
}

async function openWorkspaceDialog() {
    const selected = await window.apexApi.openFolder();
    if (selected) {
        currentWorkspace = selected;
        const wsName = currentWorkspace.split('/').pop() || 'Workspace';
        document.getElementById('workspaceName').textContent = wsName;
        refreshFileTree();
        log(`Opened workspace: ${currentWorkspace}`);
    }
}

async function refreshFileTree() {
    const container = document.getElementById('fileTreeContainer');
    container.innerHTML = '<div class="notice">Loading files...</div>';
    const tree = await window.apexApi.readDir(currentWorkspace);
    container.innerHTML = '';
    renderTree(tree, container, 0);
}

function renderTree(nodes, parentEl, depth) {
    if (!nodes || nodes.length === 0) return;
    nodes.forEach(node => {
        const row = document.createElement('div');
        row.className = 'tree-node';
        row.style.paddingLeft = `${10 + depth * 14}px`;

        const icon = document.createElement('span');
        icon.className = 'tree-node-icon';
        icon.textContent = node.isDirectory ? '📁' : getFileIcon(node.name);

        const name = document.createElement('span');
        name.className = 'tree-node-name';
        name.textContent = node.name;

        row.appendChild(icon);
        row.appendChild(name);

        if (node.isDirectory) {
            let expanded = false;
            const childContainer = document.createElement('div');
            childContainer.style.display = 'none';

            row.onclick = () => {
                expanded = !expanded;
                icon.textContent = expanded ? '📂' : '📁';
                childContainer.style.display = expanded ? 'block' : 'none';
                if (expanded && childContainer.children.length === 0) {
                    renderTree(node.children, childContainer, depth + 1);
                }
            };
            parentEl.appendChild(row);
            parentEl.appendChild(childContainer);
        } else {
            row.onclick = () => openFile(node.path, node.name);
            parentEl.appendChild(row);
        }
    });
}

function getFileIcon(filename) {
    if (filename.endsWith('.py')) return '🐍';
    if (filename.endsWith('.ts') || filename.endsWith('.js')) return '📜';
    if (filename.endsWith('.json')) return '⚙️';
    if (filename.endsWith('.md')) return '📝';
    if (filename.endsWith('.html')) return '🌐';
    if (filename.endsWith('.css')) return '🎨';
    return '📄';
}

function getLanguageForFile(filename) {
    if (filename.endsWith('.py')) return 'python';
    if (filename.endsWith('.ts')) return 'typescript';
    if (filename.endsWith('.js')) return 'javascript';
    if (filename.endsWith('.json')) return 'json';
    if (filename.endsWith('.md')) return 'markdown';
    if (filename.endsWith('.html')) return 'html';
    if (filename.endsWith('.css')) return 'css';
    if (filename.endsWith('.sh')) return 'shell';
    if (filename.endsWith('.rs')) return 'rust';
    if (filename.endsWith('.go')) return 'go';
    if (filename.endsWith('.cpp') || filename.endsWith('.c')) return 'cpp';
    return 'plaintext';
}

// File Operations & Tabs
async function openFile(filePath, fileName) {
    let tab = openTabs.find(t => t.path === filePath);
    if (!tab) {
        const content = await window.apexApi.readFile(filePath);
        if (content && typeof content === 'object' && content.error) {
            log(`Error opening file: ${content.error}`);
            return;
        }
        tab = {
            path: filePath,
            name: fileName || filePath.split('/').pop(),
            language: getLanguageForFile(fileName || filePath),
            content: content || '',
            isDirty: false
        };
        openTabs.push(tab);
    }

    activeTabPath = tab.path;
    renderTabs();

    if (editor) {
        const model = monaco.editor.createModel(tab.content, tab.language);
        editor.setModel(model);
    }

    document.getElementById('statusFileLabel').textContent = tab.name;
    document.getElementById('statusLanguage').textContent = tab.language.toUpperCase();
}

function renderTabs() {
    const container = document.getElementById('tabsHeader');
    container.innerHTML = '';

    openTabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = `editor-tab ${tab.path === activeTabPath ? 'active' : ''}`;
        
        const label = document.createElement('span');
        label.textContent = `${tab.name}${tab.isDirty ? ' •' : ''}`;
        label.onclick = () => openFile(tab.path, tab.name);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '✕';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            closeTab(tab.path);
        };

        el.appendChild(label);
        el.appendChild(closeBtn);
        container.appendChild(el);
    });
}

function closeTab(filePath) {
    const idx = openTabs.findIndex(t => t.path === filePath);
    if (idx !== -1) {
        openTabs.splice(idx, 1);
        if (activeTabPath === filePath) {
            if (openTabs.length > 0) {
                const nextTab = openTabs[Math.max(0, idx - 1)];
                openFile(nextTab.path, nextTab.name);
            } else {
                activeTabPath = null;
                if (editor) editor.setValue('');
                document.getElementById('statusFileLabel').textContent = 'No File Open';
            }
        }
        renderTabs();
    }
}

async function saveCurrentFile() {
    if (!activeTabPath || !editor) return;
    const tab = openTabs.find(t => t.path === activeTabPath);
    if (!tab) return;

    const content = editor.getValue();
    const res = await window.apexApi.writeFile(tab.path, content);
    if (res.success) {
        tab.isDirty = false;
        tab.content = content;
        renderTabs();
        log(`Saved: ${tab.path}`);
    } else {
        log(`Failed to save: ${res.error}`);
    }
}

async function promptNewFile() {
    const name = prompt('Enter new file name:');
    if (name) {
        const fullPath = `${currentWorkspace}/${name}`;
        await window.apexApi.createFile(fullPath);
        refreshFileTree();
        openFile(fullPath, name);
    }
}

async function promptNewFolder() {
    const name = prompt('Enter new folder name:');
    if (name) {
        const fullPath = `${currentWorkspace}/${name}`;
        await window.apexApi.createFolder(fullPath);
        refreshFileTree();
    }
}

// Sidebar Navigation
function switchSidebarView(viewId) {
    document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));

    if (viewId === 'explorer') {
        document.getElementById('actBtnExplorer').classList.add('active');
        document.getElementById('viewExplorer').classList.add('active');
    } else {
        document.getElementById('actBtnAi').classList.add('active');
        document.getElementById('viewAi').classList.add('active');
    }
}

function switchAiTab(tabId) {
    document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ai-content').forEach(c => c.classList.remove('active'));

    if (tabId === 'plan') {
        document.getElementById('aiTabPlanBtn').classList.add('active');
        document.getElementById('aiPlanView').classList.add('active');
    } else {
        document.getElementById('aiTabActBtn').classList.add('active');
        document.getElementById('aiActView').classList.add('active');
    }
}

function switchToAiTab(tabId) {
    switchSidebarView('ai');
    switchAiTab(tabId);
}

// Engine Daemon & Model Switcher
async function checkDaemonStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
            const data = await res.json();
            const ind = document.getElementById('engineStatus');
            ind.className = 'status-indicator status-online';
            ind.textContent = '● Engine Online';
            if (data.think_model) activeThinkModel = data.think_model;
            if (data.coder_model) activeCoderModel = data.coder_model;
            fetchModels();
        } else {
            setOffline();
        }
    } catch {
        setOffline();
    }
}

function setOffline() {
    const ind = document.getElementById('engineStatus');
    ind.className = 'status-indicator status-offline';
    ind.textContent = '● Engine Offline';
}

async function fetchModels() {
    try {
        const res = await fetch(`${API_BASE}/api/models`);
        if (!res.ok) return;
        const data = await res.json();
        
        populateSelect('thinkModelSelect', data.all_models, activeThinkModel);
        populateSelect('coderModelSelect', data.all_models, activeCoderModel);
    } catch (e) {
        console.error('Error fetching models:', e);
    }
}

function populateSelect(selectId, options, selectedVal) {
    const el = document.getElementById(selectId);
    if (!el) return;
    el.innerHTML = '';
    (options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        if (opt === selectedVal) o.selected = true;
        el.appendChild(o);
    });
}

async function selectSuite(suite) {
    document.querySelectorAll('.suite-pill').forEach(p => p.classList.remove('active'));
    document.getElementById(`suite-${suite}`)?.classList.add('active');

    let think = 'apex-phi-think-14b';
    let coder = 'apex-phi-coder-14b';

    if (suite === 'mistral') {
        think = 'apex-mistral-think-22b';
        coder = 'apex-mistral-coder-22b';
    } else if (suite === 'qwen') {
        think = 'apex-think-14b';
        coder = 'apex-coder-14b';
    }

    activeThinkModel = think;
    activeCoderModel = coder;

    document.getElementById('statusActiveSuite').textContent = `Suite: ${suite.toUpperCase()}`;

    await fetch(`${API_BASE}/api/models/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ think_model: think, coder_model: coder })
    });

    log(`Switched to ${suite.toUpperCase()} suite: ${think} + ${coder}`);
    fetchModels();
}

async function onModelSelectChange() {
    const think = document.getElementById('thinkModelSelect').value;
    const coder = document.getElementById('coderModelSelect').value;
    activeThinkModel = think;
    activeCoderModel = coder;

    await fetch(`${API_BASE}/api/models/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ think_model: think, coder_model: coder })
    });

    log(`Selected models: Think=${think}, Code=${coder}`);
}

// AI Cognition & Plan Generation
async function requestPlan() {
    const prompt = document.getElementById('featurePrompt').value.trim();
    if (!prompt) {
        alert('Please enter a feature description.');
        return;
    }

    const allowSearch = document.getElementById('allowSearch').checked;
    const btn = document.getElementById('btnSynthesize');
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Synthesizing (${activeThinkModel})...</span>`;

    const feedCard = document.getElementById('feedCard');
    feedCard.classList.remove('hidden');
    const feedBox = document.getElementById('activityFeed');
    feedBox.textContent = `[Cognitive Plan Initiated]\nTarget Model: ${activeThinkModel}\nFeature: "${prompt}"\nWeb Research: ${allowSearch}\n`;

    log(`Synthesizing feature plan with ${activeThinkModel}...`);

    try {
        const resp = await fetch(`${API_BASE}/api/plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                allow_search: allowSearch,
                think_model: activeThinkModel
            })
        });

        const data = await resp.json();
        btn.disabled = false;
        btn.innerHTML = `<span>🚀 Synthesize Plan</span>`;

        if (data.status === 'success') {
            renderPlan(data.plan);
            log(`Plan synthesized: "${data.plan.feature_name}" with ${data.plan.steps.length} steps.`);
        } else {
            alert(`Planning failed: ${data.detail || 'Unknown error'}`);
        }
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = `<span>🚀 Synthesize Plan</span>`;
        log(`Planning error: ${e.message}`);
    }
}

function renderPlan(plan) {
    currentPlan = plan;
    const summaryCard = document.getElementById('planSummaryCard');
    summaryCard.classList.remove('hidden');

    document.getElementById('planFeatureName').textContent = plan.feature_name || 'Feature Plan';
    document.getElementById('planObjective').textContent = plan.objective || '';

    const invList = document.getElementById('planInvariants');
    invList.innerHTML = '';
    (plan.invariants || []).forEach(inv => {
        const li = document.createElement('li');
        li.textContent = inv;
        invList.appendChild(li);
    });

    const previewList = document.getElementById('planStepsPreview');
    previewList.innerHTML = '';
    (plan.steps || []).forEach(s => {
        const item = document.createElement('div');
        item.style.fontSize = '11px';
        item.style.padding = '3px 0';
        item.innerHTML = `<strong>#${s.id}</strong> ${s.title} ➔ <code>${s.target_file}</code>`;
        previewList.appendChild(item);
    });

    // Populate Act view
    document.getElementById('noPlanNotice').classList.add('hidden');
    const container = document.getElementById('stepsContainer');
    container.innerHTML = '';

    (plan.steps || []).forEach(step => {
        const card = document.createElement('div');
        card.className = 'step-card';
        card.id = `step-card-${step.id}`;

        const statusClass = step.status === 'completed' ? 'badge-completed' : (step.status === 'failed' ? 'badge-failed' : 'badge-pending');
        const statusText = step.status ? step.status.toUpperCase() : 'PENDING';

        card.innerHTML = `
            <div class="step-top">
                <strong>Step ${step.id}: ${step.title}</strong>
                <span id="badge-step-${step.id}" class="badge-status ${statusClass}">${statusText}</span>
            </div>
            <div class="step-file" onclick="openFile('${currentWorkspace}/${step.target_file}', '${step.target_file}')">${step.target_file || '(Execution step)'}</div>
            <p style="font-size:11px; color:#cccccc;">${step.description}</p>
            <div style="margin-top:6px;">
                <button class="btn btn-primary btn-sm" onclick="executeStep(${step.id})">Execute Step</button>
            </div>
            ${step.verification_command ? `<div style="font-size:10px; color:#858585; margin-top:4px;">Verify: <code>${step.verification_command}</code></div>` : ''}
        `;
        container.appendChild(card);
    });
}

async function executeStep(stepId) {
    const badge = document.getElementById(`badge-step-${stepId}`);
    if (badge) {
        badge.className = 'badge-status badge-running';
        badge.textContent = 'RUNNING';
    }

    log(`Executing Step ${stepId} with ${activeCoderModel}...`);

    try {
        const res = await fetch(`${API_BASE}/api/execute-step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                step_id: stepId,
                coder_model: activeCoderModel
            })
        });

        const data = await res.json();
        if (data.status === 'success') {
            badge.className = 'badge-status badge-completed';
            badge.textContent = 'VERIFIED';
            log(`Step ${stepId} verified!`);

            // If target file was modified, open or reload in editor
            if (data.step && data.step.target_file) {
                const targetFull = `${currentWorkspace}/${data.step.target_file}`;
                await openFile(targetFull, data.step.target_file);
            }
        } else {
            badge.className = 'badge-status badge-failed';
            badge.textContent = 'FAILED';
            log(`Step ${stepId} failed: ${data.result?.error || 'Unknown error'}`);
        }
    } catch (e) {
        log(`Execution error: ${e.message}`);
    }
}

async function executeAllSteps() {
    if (!currentPlan || !currentPlan.steps) return;
    log(`Executing all planned steps with ${activeCoderModel}...`);
    try {
        const res = await fetch(`${API_BASE}/api/execute-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coder_model: activeCoderModel })
        });
        const data = await res.json();
        log(`All steps execution finished.`);
        renderPlan(data.plan);
    } catch (e) {
        log(`Batch execution error: ${e.message}`);
    }
}

// Terminal Drawer Controls
function log(msg) {
    const term = document.getElementById('terminalBody');
    if (!term) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
}

function clearLogs() {
    document.getElementById('terminalBody').innerHTML = '';
}

function toggleTerminal() {
    const drawer = document.getElementById('terminalDrawer');
    drawer.classList.toggle('collapsed');
}

// Native Menu Listeners
function setupMenuListeners() {
    window.apexApi.onMenuAction((action) => {
        switch (action.type) {
            case 'saveFile':
                saveCurrentFile();
                break;
            case 'newFile':
                promptNewFile();
                break;
            case 'workspaceOpened':
                currentWorkspace = action.path;
                loadInitialWorkspace();
                break;
            case 'focusPlan':
                switchToAiTab('plan');
                document.getElementById('featurePrompt')?.focus();
                break;
            case 'executeAll':
                executeAllSteps();
                break;
            case 'switchSuite':
                selectSuite(action.suite);
                break;
        }
    });
}
