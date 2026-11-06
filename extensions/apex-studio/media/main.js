// Apex Studio Webview Controller
const vscode = acquireVsCodeApi();

let currentPlan = null;
let activeThinkModel = 'apex-phi-think-14b';
let activeCoderModel = 'apex-phi-coder-14b';

// Tab Switching
function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    if (tabId === 'plan') {
        document.getElementById('tabPlanBtn').classList.add('active');
        document.getElementById('planView').classList.add('active');
    } else {
        document.getElementById('tabActBtn').classList.add('active');
        document.getElementById('actView').classList.add('active');
    }
}

function addLog(msg) {
    const term = document.getElementById('terminalLogs');
    if (!term) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
}

function toggleLogs() {
    const term = document.getElementById('terminalLogs');
    const icon = document.getElementById('logToggleIcon');
    if (term.classList.contains('hidden')) {
        term.classList.remove('hidden');
        icon.textContent = '▼';
    } else {
        term.classList.add('hidden');
        icon.textContent = '▲';
    }
}

function checkEngineStatus() {
    vscode.postMessage({ type: 'checkStatus' });
    vscode.postMessage({ type: 'fetchModels' });
}

// Model Suite Switching
function selectSuite(suiteName) {
    document.querySelectorAll('.suite-pill').forEach(p => p.classList.remove('active'));
    const pill = document.getElementById(`suite-${suiteName}`);
    if (pill) pill.classList.add('active');

    let think = 'apex-phi-think-14b';
    let coder = 'apex-phi-coder-14b';

    if (suiteName === 'mistral') {
        think = 'apex-mistral-think-22b';
        coder = 'apex-mistral-coder-22b';
    } else if (suiteName === 'qwen') {
        think = 'apex-think-14b';
        coder = 'apex-coder-14b';
    }

    setSelectValue('thinkModelSelect', think);
    setSelectValue('coderModelSelect', coder);

    activeThinkModel = think;
    activeCoderModel = coder;

    addLog(`Switched to ${suiteName.toUpperCase()} suite: Think=${think}, Code=${coder}`);
    vscode.postMessage({
        type: 'selectModels',
        think_model: think,
        coder_model: coder
    });
}

function onModelSelectChange() {
    const think = document.getElementById('thinkModelSelect').value;
    const coder = document.getElementById('coderModelSelect').value;

    activeThinkModel = think;
    activeCoderModel = coder;

    // Check if matches a preset suite
    document.querySelectorAll('.suite-pill').forEach(p => p.classList.remove('active'));
    if (think === 'apex-phi-think-14b' && coder === 'apex-phi-coder-14b') {
        const p = document.getElementById('suite-phi');
        if (p) p.classList.add('active');
    } else if (think === 'apex-mistral-think-22b' && coder === 'apex-mistral-coder-22b') {
        const p = document.getElementById('suite-mistral');
        if (p) p.classList.add('active');
    } else if (think === 'apex-think-14b' && coder === 'apex-coder-14b') {
        const p = document.getElementById('suite-qwen');
        if (p) p.classList.add('active');
    }

    addLog(`Updated models: Think=${think}, Code=${coder}`);
    vscode.postMessage({
        type: 'selectModels',
        think_model: think,
        coder_model: coder
    });
}

function setSelectValue(selectId, val) {
    const el = document.getElementById(selectId);
    if (!el) return;
    for (let opt of el.options) {
        if (opt.value === val) {
            el.value = val;
            return;
        }
    }
    // Add option if not present
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    opt.selected = true;
    el.appendChild(opt);
}

function populateDropdown(selectId, models, currentVal) {
    const el = document.getElementById(selectId);
    if (!el) return;
    el.innerHTML = '';
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === currentVal) opt.selected = true;
        el.appendChild(opt);
    });
    if (currentVal && !models.includes(currentVal)) {
        const opt = document.createElement('option');
        opt.value = currentVal;
        opt.textContent = currentVal;
        opt.selected = true;
        el.appendChild(opt);
    }
}

function requestPlan() {
    const prompt = document.getElementById('featurePrompt').value.trim();
    if (!prompt) {
        addLog('Error: Feature specification cannot be empty.');
        return;
    }

    const allowSearch = document.getElementById('allowSearch').checked;
    const btn = document.getElementById('btnPlan');
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Synthesizing (${activeThinkModel})...</span>`;

    const activityCard = document.getElementById('activityCard');
    activityCard.classList.remove('hidden');
    const feed = document.getElementById('activityFeed');
    feed.textContent = `Autonomous Cognition Initialized (${activeThinkModel})...\n- Exploring requirements for: "${prompt}"\n- Web search enabled: ${allowSearch}\n`;

    addLog(`Initiating planning with ${activeThinkModel}...`);
    vscode.postMessage({
        type: 'planFeature',
        prompt: prompt,
        allow_search: allowSearch,
        think_model: activeThinkModel
    });
}

function executeStep(stepId) {
    addLog(`Executing Step ${stepId} with ${activeCoderModel}...`);
    const badge = document.getElementById(`badge-step-${stepId}`);
    if (badge) {
        badge.className = 'badge-status badge-running';
        badge.textContent = 'Running';
    }
    vscode.postMessage({
        type: 'executeStep',
        step_id: stepId,
        coder_model: activeCoderModel
    });
}

function executeAll() {
    if (!currentPlan || !currentPlan.steps) return;
    addLog(`Triggering execution of all steps with ${activeCoderModel}...`);
    vscode.postMessage({
        type: 'executeAll',
        coder_model: activeCoderModel
    });
}

function openFile(filePath) {
    vscode.postMessage({ type: 'openFile', file: filePath });
}

// Renderers
function renderPlan(plan) {
    currentPlan = plan;
    const btn = document.getElementById('btnPlan');
    btn.disabled = false;
    btn.innerHTML = '<span>🚀 Synthesize Plan</span>';

    // Plan card in Plan Tab
    const planCard = document.getElementById('planSummaryCard');
    planCard.classList.remove('hidden');
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
    (plan.steps || []).forEach(step => {
        const item = document.createElement('div');
        item.className = 'step-preview-item';
        item.innerHTML = `<span><strong>#${step.id}</strong> ${step.title}</span><span class="step-file">${step.target_file}</span>`;
        previewList.appendChild(item);
    });

    // Act Tab
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
                <span class="step-num">Step ${step.id}: ${step.title}</span>
                <span id="badge-step-${step.id}" class="badge-status ${statusClass}">${statusText}</span>
            </div>
            <div class="step-desc">${step.description}</div>
            <div class="step-file" onclick="openFile('${step.target_file}')">${step.target_file || '(Command step)'}</div>
            <div class="step-actions">
                <button class="btn btn-primary btn-sm" onclick="executeStep(${step.id})">Execute with ${activeCoderModel}</button>
            </div>
            ${step.verification_command ? `<div class="text-muted" style="font-size:10px;">Verify: <code>${step.verification_command}</code></div>` : ''}
        `;
        container.appendChild(card);
    });
}

// Handle messages from Extension Host
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'statusUpdate': {
            const statusEl = document.getElementById('engineStatus');
            if (message.data.status === 'online') {
                statusEl.className = 'status-pill status-online';
                statusEl.textContent = 'Engine Online';
            } else {
                statusEl.className = 'status-pill status-offline';
                statusEl.textContent = 'Engine Offline';
            }
            if (message.data.think_model) activeThinkModel = message.data.think_model;
            if (message.data.coder_model) activeCoderModel = message.data.coder_model;

            if (message.data.recent_logs) {
                message.data.recent_logs.forEach(l => addLog(l));
            }
            break;
        }
        case 'modelsLoaded': {
            const data = message.data;
            if (data.active_think_model) activeThinkModel = data.active_think_model;
            if (data.active_coder_model) activeCoderModel = data.active_coder_model;

            const allModels = data.all_models || [];
            populateDropdown('thinkModelSelect', allModels, activeThinkModel);
            populateDropdown('coderModelSelect', allModels, activeCoderModel);

            // Set active pill if matches
            document.querySelectorAll('.suite-pill').forEach(p => p.classList.remove('active'));
            if (activeThinkModel === 'apex-phi-think-14b' && activeCoderModel === 'apex-phi-coder-14b') {
                document.getElementById('suite-phi')?.classList.add('active');
            } else if (activeThinkModel === 'apex-mistral-think-22b' && activeCoderModel === 'apex-mistral-coder-22b') {
                document.getElementById('suite-mistral')?.classList.add('active');
            } else if (activeThinkModel === 'apex-think-14b' && activeCoderModel === 'apex-coder-14b') {
                document.getElementById('suite-qwen')?.classList.add('active');
            }
            break;
        }
        case 'modelsUpdated': {
            const data = message.data;
            activeThinkModel = data.active_think_model;
            activeCoderModel = data.active_coder_model;
            setSelectValue('thinkModelSelect', activeThinkModel);
            setSelectValue('coderModelSelect', activeCoderModel);
            break;
        }
        case 'planCreated': {
            addLog(`Plan generated: ${message.data.feature_name}`);
            renderPlan(message.data);
            break;
        }
        case 'planError': {
            const btn = document.getElementById('btnPlan');
            btn.disabled = false;
            btn.innerHTML = '<span>🚀 Synthesize Plan</span>';
            addLog(`Planning failed: ${message.error}`);
            break;
        }
        case 'stepExecuted': {
            const res = message.data;
            const badge = document.getElementById(`badge-step-${res.step.id}`);
            if (badge) {
                if (res.status === 'success') {
                    badge.className = 'badge-status badge-completed';
                    badge.textContent = 'VERIFIED';
                    addLog(`Step ${res.step.id} completed and verified using ${res.model_used || activeCoderModel}.`);
                } else {
                    badge.className = 'badge-status badge-failed';
                    badge.textContent = 'FAILED';
                    addLog(`Step ${res.step.id} failed: ${res.result?.error || 'Unknown error'}`);
                }
            }
            break;
        }
        case 'allExecuted': {
            addLog('All steps execution batch completed.');
            checkEngineStatus();
            break;
        }
    }
});

// Initial boot check
checkEngineStatus();
setInterval(checkEngineStatus, 15000);
