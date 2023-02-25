import path from 'node:path';
import * as vscode from 'vscode';
import * as util from './util';

export let config: vscode.WorkspaceConfiguration;
export let blockDecorationType: vscode.TextEditorDecorationType;
export const PKG_NAME = 'duplicatedCode';
export const PKG_TITLE = 'Duplicated Code';

export function readConfig() {
    config = vscode.workspace.getConfiguration(PKG_NAME);
}

export function createDecorationType() {
    blockDecorationType = vscode.window.createTextEditorDecorationType(
        Object.assign({}, util.config.decorationStyles, {
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        }),
    );
}

export function getFileNameFromPath(filePath) {
    return path.parse(filePath).name;
}
