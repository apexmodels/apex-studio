// Apex Studio Webview Controller
const vscode = acquireVsCodeApi();

let currentPlan = null;

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
    btn.innerHTML = '<span>⏳ Synthesizing (ApexPhi-Think)...</span>';

    const activityCard = document.getElementById('activityCard');
    activityCard.classList.remove('hidden');
    const feed = document.getElementById('activityFeed');
    feed.textContent = `Autonomous Cognition Initialized...\n- Exploring requirements for: "${prompt}"\n- Web search enabled: ${allowSearch}\n`;

    addLog(`Initiating planning with ApexPhi-Think-14B...`);
    vscode.postMessage({
        type: 'planFeature',
        prompt: prompt,
        allow_search: allowSearch
    });
}

function executeStep(stepId) {
    addLog(`Executing Step ${stepId} with ApexPhi-Coder...`);
    const badge = document.getElementById(`badge-step-${stepId}`);
    if (badge) {
        badge.className = 'badge-status badge-running';
        badge.textContent = 'Running';
    }
    vscode.postMessage({ type: 'executeStep', step_id: stepId });
}

function executeAll() {
    if (!currentPlan || !currentPlan.steps) return;
    addLog(`Triggering execution of all steps...`);
    vscode.postMessage({ type: 'executeAll' });
}

function openFile(filePath) {
    vscode.postMessage({ type: 'openFile', file: filePath });
}

// Renderers
function renderPlan(plan) {
    currentPlan = plan;
    const btn = document.getElementById('btnPlan');
    btn.disabled = false;
    btn.innerHTML = '<span>🚀 Synthesize Plan with ApexPhi-Think</span>';

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
                <button class="btn btn-primary btn-sm" onclick="executeStep(${step.id})">Execute Step</button>
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
            if (message.data.recent_logs) {
                message.data.recent_logs.forEach(l => addLog(l));
            }
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
            btn.innerHTML = '<span>🚀 Synthesize Plan with ApexPhi-Think</span>';
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
                    addLog(`Step ${res.step.id} completed and verified.`);
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
