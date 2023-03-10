import { IClone, IMapFrame, IOptions, MemoryStore } from '@jscpd/core';
import { detectClones } from 'jscpd';
import * as vscode from 'vscode';
import { DuplicatedCode } from './duplicated-code';
import { DuplicatedCodeType } from './duplicated-code-type.enum';
import * as util from './util';

export class DuplicatedCodeProvider implements vscode.TreeDataProvider<DuplicatedCode> {
    public _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    private clones: IClone[] = [];

    constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined) { }

    getTreeItem(element: DuplicatedCode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: DuplicatedCode | undefined): vscode.ProviderResult<DuplicatedCode[]> {
        if (!this.workspaceFolders || this.workspaceFolders.length === 0) {
            vscode.window.showInformationMessage('Empty workspace');

            return Promise.resolve([]);
        }

        if (!element) {
            return this.workspaceFolders.map(
                (workspace) =>
                    new DuplicatedCode(
                        -1,
                        undefined,
                        DuplicatedCodeType.workspace,
                        workspace,
                        this.workspaceFolders?.length === 1 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    ),
            );
        } else if (element.type === DuplicatedCodeType.workspace) {
            const options: IOptions = Object.assign({}, util.config.options, {
                path   : [`${element.workspaceFolder?.uri.path!}/`],
                ignore : util.config.exclude,
                output : undefined,
            });

            return detectClones(options, new MemoryStore<IMapFrame>())
                .then((clones: IClone[]) => {
                    this.clones = clones;

                    return clones
                        .sort((a, b) => (a.duplicationA.sourceId == a.duplicationB.sourceId ? 1 : -1))
                        .reverse()
                        .map(
                            (clone, index) => new DuplicatedCode(
                                index,
                                clone,
                                DuplicatedCodeType.line,
                                undefined,
                                vscode.TreeItemCollapsibleState.None,
                            ),
                        );
                })
                .catch((error) => {
                    console.error(error);

                    return [];
                });
        } else {
            return [
                new DuplicatedCode(
                    -1,
                    this.clones[element.index],
                    DuplicatedCodeType.detail,
                    undefined,
                    vscode.TreeItemCollapsibleState.None,
                ),
            ];
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
}
