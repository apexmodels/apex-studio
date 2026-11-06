import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { URL } from 'url';

const ENGINE_URL = 'http://127.0.0.1:8000';

function postJson(endpoint: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, ENGINE_URL);
        const body = JSON.stringify(data);
        const req = http.request(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 120000
            },
            (res) => {
                let responseBody = '';
                res.on('data', (chunk) => { responseBody += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(responseBody);
                        resolve(json);
                    } catch (e) {
                        resolve({ raw: responseBody, statusCode: res.statusCode });
                    }
                });
            }
        );

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request to Apex Engine timed out'));
        });
        req.write(body);
        req.end();
    });
}

function getJson(endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, ENGINE_URL);
        const req = http.request(url, { method: 'GET', timeout: 10000 }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseBody));
                } catch (e) {
                    resolve({ raw: responseBody, statusCode: res.statusCode });
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request to Apex Engine timed out'));
        });
        req.end();
    });
}

class ApexSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'checkStatus': {
                    try {
                        const status = await getJson('/api/status');
                        webviewView.webview.postMessage({ type: 'statusUpdate', data: status });
                    } catch (err: any) {
                        webviewView.webview.postMessage({
                            type: 'statusUpdate',
                            data: { status: 'offline', error: err.message }
                        });
                    }
                    break;
                }
                case 'planFeature': {
                    try {
                        vscode.window.showInformationMessage(`Apex Studio: ApexPhi-Think is researching and planning...`);
                        const result = await postJson('/api/plan', {
                            prompt: data.prompt,
                            allow_search: data.allow_search !== false
                        });
                        webviewView.webview.postMessage({ type: 'planCreated', data: result.plan });
                        vscode.window.showInformationMessage(`Apex Studio: Plan created with ${result.plan.steps.length} steps!`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Planning failed: ${err.message}`);
                        webviewView.webview.postMessage({ type: 'planError', error: err.message });
                    }
                    break;
                }
                case 'executeStep': {
                    try {
                        const result = await postJson('/api/execute-step', { step_id: data.step_id });
                        webviewView.webview.postMessage({ type: 'stepExecuted', data: result });
                        if (result.status === 'success') {
                            vscode.window.showInformationMessage(`Apex Studio: Step ${data.step_id} executed & verified!`);
                        } else {
                            vscode.window.showWarningMessage(`Apex Studio: Step ${data.step_id} failed: ${result.result?.error}`);
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Execution failed: ${err.message}`);
                        webviewView.webview.postMessage({ type: 'stepError', error: err.message });
                    }
                    break;
                }
                case 'executeAll': {
                    try {
                        vscode.window.showInformationMessage(`Apex Studio: Executing all planned steps with ApexPhi-Coder...`);
                        const result = await postJson('/api/execute-all', {});
                        webviewView.webview.postMessage({ type: 'allExecuted', data: result });
                        vscode.window.showInformationMessage(`Apex Studio: All steps executed!`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Execution failed: ${err.message}`);
                    }
                    break;
                }
                case 'openFile': {
                    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                        const root = vscode.workspace.workspaceFolders[0].uri;
                        const fileUri = vscode.Uri.joinPath(root, data.file);
                        try {
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await vscode.window.showTextDocument(doc);
                        } catch (err: any) {
                            vscode.window.showErrorMessage(`Could not open file: ${data.file}`);
                        }
                    }
                    break;
                }
                case 'startDaemon': {
                    startEngineTerminal();
                    break;
                }
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');

        html = html.replace('${styleUri}', styleUri.toString());
        html = html.replace('${scriptUri}', scriptUri.toString());
        return html;
    }
}

function startEngineTerminal() {
    let terminal = vscode.window.terminals.find((t) => t.name === 'Apex Studio Engine');
    if (!terminal) {
        terminal = vscode.window.createTerminal('Apex Studio Engine');
    }
    terminal.show();
    terminal.sendText('python3 -m engine.server');
    vscode.window.showInformationMessage('Apex Studio Daemon started on http://127.0.0.1:8000');
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new ApexSidebarProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('apexStudio.sidebar', provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('apexStudio.startDaemon', () => {
            startEngineTerminal();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('apexStudio.planFeature', async () => {
            const prompt = await vscode.window.showInputBox({
                prompt: 'Describe the feature you want Apex Studio to research and plan:',
                placeHolder: 'e.g. Implement robust rate-limiting middleware with Redis token bucket algorithm'
            });
            if (prompt) {
                try {
                    vscode.window.showInformationMessage('Apex Studio: Planning feature with ApexPhi-Think-14B...');
                    const result = await postJson('/api/plan', { prompt, allow_search: true });
                    vscode.window.showInformationMessage(`Plan ready with ${result.plan.steps.length} steps!`);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Planning failed: ${e.message}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('apexStudio.executeAll', async () => {
            try {
                vscode.window.showInformationMessage('Executing all planned steps with ApexPhi-Coder...');
                await postJson('/api/execute-all', {});
            } catch (e: any) {
                vscode.window.showErrorMessage(`Execution failed: ${e.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('apexStudio.refresh', async () => {
            vscode.window.showInformationMessage('Apex Studio: Status refreshed.');
        })
    );
}

export function deactivate() {}
