import * as vscode from 'vscode';
import { DuplicatedCode } from './duplicated-code';
import { DuplicatedCodeProvider } from './duplicated-code.provider';
import * as util from './util';

export function activate(context: vscode.ExtensionContext) {
    const duplicatedCodeProvider = new DuplicatedCodeProvider(vscode.workspace.workspaceFolders);

    util.readConfig();
    util.createDecorationType();

    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(util.PKG_NAME, duplicatedCodeProvider),
        vscode.commands.registerCommand('duplicatedCode.refreshEntry', () => duplicatedCodeProvider._onDidChangeTreeData.fire()),
        vscode.commands.registerCommand('duplicatedCode.openFile', async (duplicateCode: DuplicatedCode) => await duplicateCode.openFile()),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(util.PKG_NAME)) {
                util.readConfig();
                util.createDecorationType();
                duplicatedCodeProvider._onDidChangeTreeData.fire();
            }
        }),
    );
}

export function deactivate() { }
