import * as vscode from 'vscode';
import * as util from './util';

import { DuplicatedCode } from './duplicated-code';
import { DuplicatedCodeProvider } from './duplicated-code.provider';

export function activate(context: vscode.ExtensionContext) {
    const duplicatedCodeProvider = new DuplicatedCodeProvider(vscode.workspace.workspaceFolders);

    util.readConfig();
    util.createDecorationType();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(util.PKG_NAME, duplicatedCodeProvider),
        vscode.commands.registerCommand('duplicatedCode.refreshEntry', () => duplicatedCodeProvider._onDidChangeTreeData.fire()),
        vscode.commands.registerCommand('duplicatedCode.openFile', (duplicateCode: DuplicatedCode) => duplicateCode.openFile()),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(util.PKG_NAME)) {
                util.readConfig();
                duplicatedCodeProvider._onDidChangeTreeData.fire();
            }
        }),
    );
}

export function deactivate() { }
