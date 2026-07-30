import * as vscode from 'vscode'
import {DuplicatedCode} from './duplicated-code'
import {DuplicatedCodeProvider} from './duplicated-code.provider'
import * as util from './util'

export function activate(context: vscode.ExtensionContext) {
    const duplicatedCodeProvider = new DuplicatedCodeProvider()

    util.readConfig()
    util.createDecorationType()

    const treeView = vscode.window.createTreeView(util.PKG_NAME, {
        treeDataProvider : duplicatedCodeProvider,
        showCollapseAll  : true,
    })
    duplicatedCodeProvider.treeView = treeView

    context.subscriptions.push(
        treeView,
        vscode.commands.registerCommand('duplicatedCode.refreshEntry', () => duplicatedCodeProvider.refresh()),
        vscode.commands.registerCommand('duplicatedCode.openFile', async(duplicateCode: DuplicatedCode) => await duplicateCode.openFile()),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(util.PKG_NAME)) {
                util.readConfig()
                util.createDecorationType()
                duplicatedCodeProvider.refresh()
            }
        }),
    )

    const watchers = new Map<vscode.WorkspaceFolder, vscode.FileSystemWatcher>()

    const createWatcher = (folder: vscode.WorkspaceFolder): vscode.FileSystemWatcher => {
        const configPattern = new vscode.RelativePattern(folder, '.jscpd.json')
        const watcher = vscode.workspace.createFileSystemWatcher(configPattern)
        watcher.onDidChange(() => duplicatedCodeProvider.refresh())
        watcher.onDidCreate(() => duplicatedCodeProvider.refresh())
        watcher.onDidDelete(() => duplicatedCodeProvider.refresh())

        return watcher
    }

    const addFolder = (folder: vscode.WorkspaceFolder): void => {
        if (watchers.has(folder)) {
            return
        }

        const watcher = createWatcher(folder)
        watchers.set(folder, watcher)
        context.subscriptions.push(watcher)
        duplicatedCodeProvider.refresh()
    }

    const removeFolder = (folder: vscode.WorkspaceFolder): void => {
        const watcher = watchers.get(folder)

        if (!watcher) {
            return
        }

        watchers.delete(folder)
        watcher.dispose()
        context.subscriptions.splice(context.subscriptions.indexOf(watcher), 1)
        duplicatedCodeProvider.refresh()
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        addFolder(folder)
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders((event) => {
            event.added.forEach(addFolder)
            event.removed.forEach(removeFolder)
        }),
    )
}

export function deactivate() { }
