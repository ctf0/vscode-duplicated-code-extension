import { IClone } from '@jscpd/core';
import * as vscode from 'vscode';
import { DuplicatedCodeType } from './duplicated-code-type.enum';
import * as util from './util';

export class DuplicatedCode extends vscode.TreeItem {
    public title?: string;

    private range1?: vscode.Range;
    private range2?: vscode.Range;
    private fileuri1?: vscode.Uri;
    private fileuri2?: vscode.Uri;
    private counter = 0;

    constructor(
        public readonly index: number,
        public readonly clone: IClone | undefined,
        public readonly type: DuplicatedCodeType,
        public readonly workspaceFolder: vscode.WorkspaceFolder | undefined,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super('', collapsibleState);

        if (type === DuplicatedCodeType.workspace) {
            this.label = workspaceFolder?.name;
        } else if (clone) {
            const cloneA = clone.duplicationA;
            const cloneB = clone.duplicationB;

            const fileAPath = cloneA.sourceId;
            const fileBPath = cloneB.sourceId;

            const filenameA = util.getFileNameFromPath(fileAPath);
            const filenameB = util.getFileNameFromPath(fileBPath);

            const filename = fileAPath == fileBPath ? filenameA : `${filenameA} ∴ ${filenameB}`;

            const startA = `${cloneA.start.line}:${cloneA.start.column}`;
            const endA = `${cloneA.end.line}:${cloneA.end.column}`;

            const startB = `${cloneB.start.line}:${cloneB.start.column}`;
            const endB = `${cloneB.end.line}:${cloneB.end.column}`;

            const start = type === DuplicatedCodeType.line ? startA : startB;
            const end = type === DuplicatedCodeType.line ? endA : endB;

            const description = `${start} - ${end}`;

            this.label = filename;
            this.description = description;

            this.title = filename;

            this.command = {
                title     : 'Open diff',
                command   : 'duplicatedCode.openFile',
                arguments : [this],
            };

            this.iconPath = fileAPath == fileBPath ? new vscode.ThemeIcon('eye') : new vscode.ThemeIcon('report');

            this.range1 = new vscode.Range(
                new vscode.Position(cloneA.start.line - 1, (cloneA.start.column || 1) - 1),
                new vscode.Position(cloneA.end.line - 1, (cloneA.end.column || 1) - 1),
            );

            this.range2 = new vscode.Range(
                new vscode.Position(cloneB.start.line - 1, (cloneB.start.column || 1) - 1),
                new vscode.Position(cloneB.end.line - 1, (cloneB.end.column || 1) - 1),
            );

            this.fileuri1 = vscode.Uri.file(fileAPath);
            this.fileuri2 = vscode.Uri.file(fileBPath);
        }
    }

    // @ts-ignore
    async public openFile() {
        if (this.clone) {
            if (util.config.openFilesAs === 'diff') {
                if (util.config.autoChangeViewType && (this.fileuri1!.path === this.fileuri2!.path)) {
                    return this.openNormal();
                }

                return this.openDiff();
            }

            return this.openNormal();
        }
    }

    private openDiff(): Thenable<unknown> {
        return vscode.commands.executeCommand(
            'vscode.diff',
            this.fileuri1,
            this.fileuri2,
            this.title,
            {
                viewColumn: vscode.ViewColumn.One,
            },
        );
    }

    private async openNormal(): Promise<void> {
        const revealTimeout = 250;
        const blockDecorationType = util.blockDecorationType;

        // 1st editor
        const editor1 = await vscode.window.showTextDocument(
            await vscode.workspace.openTextDocument(this.fileuri1!),
            { viewColumn: vscode.ViewColumn.One },
        );

        if (this.counter === 0) {
            editor1.setDecorations(blockDecorationType, [{
                range        : this.range1!,
                hoverMessage : `${util.PKG_TITLE} : ${this.title}`,
            }]);
        }

        setTimeout(async () => {
            editor1.revealRange(this.range1!, vscode.TextEditorRevealType.AtTop);

            // 2nd editor
            setTimeout(async () => {
                const editor2 = await vscode.window.showTextDocument(
                    await vscode.workspace.openTextDocument(this.fileuri2!),
                    { viewColumn: vscode.ViewColumn.Two },
                );

                if (this.counter === 0) {
                    editor2.setDecorations(blockDecorationType, [{
                        range        : this.range2!,
                        hoverMessage : `${util.PKG_TITLE} : ${this.title}`,
                    }]);
                }

                setTimeout(() => {
                    editor2.revealRange(this.range2!, vscode.TextEditorRevealType.AtTop);

                    // make sure scroll is synced
                    setTimeout(async () => {
                        if (this.counter === 0) {
                            this.counter++;
                            await this.openFile();
                        } else {
                            this.counter--;
                        }
                    }, 50);
                }, revealTimeout);
            }, 250);
        }, revealTimeout);
    }
}
