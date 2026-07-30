import * as vscode from 'vscode'
import {DuplicatedCodeType} from './duplicated-code-type.enum'
import * as util from './util'

// jscpd v5 JSON output types (v5 is a Rust rewrite — no @jscpd/core types)
export interface JscpdLocation {
    name  : string
    start : number
    end   : number
}

export interface JscpdClone {
    format     : string
    lines      : number
    tokens     : number
    firstFile  : JscpdLocation
    secondFile : JscpdLocation
}

export class DuplicatedCode extends vscode.TreeItem {
    public title? : string

    private range1?   : vscode.Range
    private range2?   : vscode.Range
    private fileuri1? : vscode.Uri
    private fileuri2? : vscode.Uri

    constructor(
        public readonly index: number,
        public readonly clone: JscpdClone | undefined,
        public readonly type: DuplicatedCodeType,
        public readonly workspaceFolder: vscode.WorkspaceFolder | undefined,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super('', collapsibleState)

        if (type === DuplicatedCodeType.workspace) {
            this.label = workspaceFolder?.name
        } else if (clone) {
            this.initFromClone(clone, type)
        }
    }

    private initFromClone(clone: JscpdClone, type: DuplicatedCodeType): void {
        const cloneA = clone.firstFile
        const cloneB = clone.secondFile

        const fileAPath = cloneA.name
        const fileBPath = cloneB.name

        const filenameA = util.getFileNameFromPath(fileAPath)
        const filenameB = util.getFileNameFromPath(fileBPath)

        const filename = fileAPath == fileBPath ? filenameA : `${filenameA} ∴ ${filenameB}`

        const isLine = type === DuplicatedCodeType.line
        const start = `${isLine ? cloneA.start : cloneB.start}:1`
        const end = `${isLine ? cloneA.end : cloneB.end}:1`

        this.label = filename
        this.description = `${start} - ${end}`
        this.title = filename

        this.command = {
            title     : 'Open diff',
            command   : 'duplicatedCode.openFile',
            arguments : [this],
        }

        this.iconPath = fileAPath == fileBPath ? new vscode.ThemeIcon('eye') : new vscode.ThemeIcon('report')

        this.range1 = new vscode.Range(
            new vscode.Position(cloneA.start - 1, 0),
            new vscode.Position(cloneA.end - 1, 0),
        )

        this.range2 = new vscode.Range(
            new vscode.Position(cloneB.start - 1, 0),
            new vscode.Position(cloneB.end - 1, 0),
        )

        this.fileuri1 = vscode.Uri.file(fileAPath)
        this.fileuri2 = vscode.Uri.file(fileBPath)
    }

    async openFile() {
        if (!this.clone) {
            return
        }

        const wantDiff = util.config.openFilesAs === 'diff'
        const sameFile = this.fileuri1!.path === this.fileuri2!.path

        // When openFilesAs=diff but both clones are in the same file, fall back to normal view
        // (unless autoChangeViewType is disabled, in which case the user explicitly wants diff).
        if (wantDiff && (!sameFile || !util.config.autoChangeViewType)) {
            return this.openDiff()
        }

        return this.openNormal()
    }

    private openDiff(): Thenable<unknown> {
        return vscode.commands.executeCommand(
            'vscode.diff',
            this.fileuri1,
            this.fileuri2,
            this.title,
            {
                viewColumn : vscode.ViewColumn.One,
            },
        )
    }

    private async openNormal(): Promise<void> {
        const blockDecorationType = util.blockDecorationType

        const [doc1, doc2] = await Promise.all([
            vscode.workspace.openTextDocument(this.fileuri1!),
            vscode.workspace.openTextDocument(this.fileuri2!),
        ])

        // Open both editors first so we hold stable references
        const editor1 = await vscode.window.showTextDocument(doc1, {viewColumn: vscode.ViewColumn.One, preserveFocus: false})
        const editor2 = await vscode.window.showTextDocument(doc2, {viewColumn: vscode.ViewColumn.Two, preserveFocus: false})

        // editor.unfoldAll operates on the *active* editor, so re-focus each
        // editor right before unfolding to guarantee the right target.
        await vscode.window.showTextDocument(doc1, {viewColumn: vscode.ViewColumn.One, preserveFocus: false})
        await vscode.commands.executeCommand('editor.unfoldAll')
        editor1.setDecorations(blockDecorationType, [{
            range        : this.range1!,
            hoverMessage : `${util.PKG_TITLE} : ${this.title}`,
        }])

        await vscode.window.showTextDocument(doc2, {viewColumn: vscode.ViewColumn.Two, preserveFocus: false})
        await vscode.commands.executeCommand('editor.unfoldAll')
        editor2.setDecorations(blockDecorationType, [{
            range        : this.range2!,
            hoverMessage : `${util.PKG_TITLE} : ${this.title}`,
        }])

        editor1.revealRange(this.range1!, vscode.TextEditorRevealType.AtTop)
        editor2.revealRange(this.range2!, vscode.TextEditorRevealType.AtTop)
    }
}
