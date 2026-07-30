import {execFile} from 'node:child_process'
import {readFile, mkdtemp, rm, access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'
import * as vscode from 'vscode'
import {DuplicatedCode, JscpdClone} from './duplicated-code'
import {DuplicatedCodeType} from './duplicated-code-type.enum'
import * as util from './util'

const execFileAsync = promisify(execFile)

// jscpd v5 platform-specific binary package names
const PLATFORM_PKG: Record<string, string> = {
    'darwin-arm64' : 'jscpd-darwin-arm64',
    'darwin-x64'   : 'jscpd-darwin-x64',
    'linux-x64'    : 'jscpd-linux-x64-gnu',
    'linux-arm64'  : 'jscpd-linux-arm64-gnu',
    'win32-x64'    : 'jscpd-windows-x64-msvc',
}

function resolveJscpdBinary(): string {
    const pkgName = PLATFORM_PKG[`${process.platform}-${process.arch}`]

    if (!pkgName) {
        throw new Error(`jscpd: unsupported platform ${process.platform}/${process.arch}`)
    }

    const binaryName = process.platform === 'win32' ? 'jscpd.exe' : 'jscpd'
    const pkgDir = join(__dirname, '..', 'node_modules', pkgName)

    return join(pkgDir, 'bin', binaryName)
}

const jscpdBin = resolveJscpdBinary()

let _outputChannel: vscode.OutputChannel | undefined

// Lazily created so the channel only appears when a scan actually runs
function getOutputChannel(): vscode.OutputChannel {
    return _outputChannel ??= vscode.window.createOutputChannel('Duplicated Code')
}

// Parse .jscpd.json and extract any format filter (v5 config doesn't parse comma-separated "format" correctly)
async function readJscpdFormat(configPath: string): Promise<string | undefined> {
    try {
        const raw = await readFile(configPath, 'utf-8')
        const cfg = JSON.parse(raw) as Record<string, any>
        const format = cfg.format

        if (typeof format === 'string') {
            return format
        }

        if (Array.isArray(format)) {
            return format.join(',')
        }

        return undefined
    } catch {
        return undefined
    }
}

function normalizeCloneKey(clone: JscpdClone): string {
    const a = `${clone.firstFile.name}:${clone.firstFile.start}:${clone.firstFile.end}`
    const b = `${clone.secondFile.name}:${clone.secondFile.start}:${clone.secondFile.end}`

    return a.localeCompare(b) <= 0 ? `${a}|${b}` : `${b}|${a}`
}

export class DuplicatedCodeProvider implements vscode.TreeDataProvider<DuplicatedCode> {
    public _onDidChangeTreeData : vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    // fallow-ignore-next-line unused-class-member
    public onDidChangeTreeData  : vscode.Event<void> = this._onDidChangeTreeData.event

    private clones   : JscpdClone[] = []
    public treeView? : vscode.TreeView<DuplicatedCode>

    constructor() { }

    getTreeItem(element: DuplicatedCode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element
    }

    async getChildren(element?: DuplicatedCode | undefined): Promise<DuplicatedCode[]> {
        // Read workspace folders dynamically so multi-root additions/removals are reflected
        const workspaceFolders = vscode.workspace.workspaceFolders

        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showInformationMessage('Empty workspace')

            return Promise.resolve([])
        }

        if (!element) {
            return workspaceFolders.length === 1
                ? this.getClonesForFolder(workspaceFolders[0])
                : this.buildWorkspaceNodes(workspaceFolders)
        }

        if (element.type === DuplicatedCodeType.workspace) {
            return this.getClonesForFolder(element.workspaceFolder!)
        }

        return [new DuplicatedCode(-1, this.clones[element.index], DuplicatedCodeType.detail, undefined, vscode.TreeItemCollapsibleState.None)]
    }

    private buildWorkspaceNodes(folders: readonly vscode.WorkspaceFolder[]): DuplicatedCode[] {
        return folders.map(
            (workspace) => new DuplicatedCode(
                -1,
                undefined,
                DuplicatedCodeType.workspace,
                workspace,
                vscode.TreeItemCollapsibleState.Collapsed,
            ),
        )
    }

    private async getClonesForFolder(folder: vscode.WorkspaceFolder): Promise<DuplicatedCode[]> {
        // Use fsPath for correct platform-native path (avoids /c:/... on Windows)
        const folderPath = folder.uri.fsPath
        const jscpdConfig = join(folderPath, '.jscpd.json')
        let hasConfig = false

        try {
            await access(jscpdConfig); hasConfig = true
        } catch {}

        // jscpd v5 --reporters json writes to a file, not stdout
        const tmpDir = await mkdtemp(join(tmpdir(), 'jscpd-'))
        const args = await this.buildJscpdArgs(folderPath, jscpdConfig, hasConfig, tmpDir)

        try {
            return await this.runJscpdAndParse(args, tmpDir)
        } finally {
            await rm(tmpDir, {recursive: true, force: true})
        }
    }

    private async buildJscpdArgs(folderPath: string, jscpdConfig: string, hasConfig: boolean, tmpDir: string): Promise<string[]> {
        const args: string[] = [
            folderPath,
            '--reporters', 'json',
            '--silent',
            '--no-tips',
            '--absolute',
            '--output', tmpDir,
        ]

        if (hasConfig) {
            getOutputChannel().appendLine(`Using .jscpd.json config`)
            args.push('--config', jscpdConfig)

            const format = await readJscpdFormat(jscpdConfig)

            if (format) {
                args.push('--format', format)
            }
        } else {
            this.appendOptionArgs(args)
        }

        return args
    }

    private appendOptionArgs(args: string[]): void {
        const opts = util.config.options as Record<string, any>
        args.push(
            '--min-lines', String(opts.minLines),
            '--min-tokens', String(opts.minTokens),
            '--max-lines', String(opts.maxLines),
        )

        if (!opts.gitignore) {
            args.push('--no-gitignore')
        }

        if (!opts.noSymlinks) {
            args.push('--follow-symlinks')
        }

        if (util.config.exclude?.length) {
            args.push('--ignore', util.config.exclude.join(','))
        }
    }

    private async runJscpdAndParse(args: string[], tmpDir: string): Promise<DuplicatedCode[]> {
        // jscpd exits non-zero when duplicates exceed the configured threshold (CI-gate
        // behavior), but it still writes jscpd-report.json before exiting. Treat a
        // non-zero exit as a soft signal: parse the report if present, and only fail
        // when the report is missing or unparseable.
        let execError: Error | undefined

        try {
            await execFileAsync(jscpdBin, args, {maxBuffer: 10 * 1024 * 1024})
        } catch (err: any) {
            execError = err
        }

        let reportJson: string

        try {
            reportJson = await readFile(join(tmpDir, 'jscpd-report.json'), 'utf-8')
        } catch {
            // No report file means a genuine jscpd failure (bad args, binary crash, etc.)
            const reason = execError ? execError.message || String(execError) : 'report file not written'
            getOutputChannel().appendLine(`jscpd detection failed: ${reason}`)
            getOutputChannel().show(true)

            this.updateTreeViewMessage(0)

            return []
        }

        try {
            return this.processJscpdReport(reportJson, args, execError)
        } catch (err: any) {
            getOutputChannel().appendLine(`jscpd detection failed: ${err.message || err}`)
            getOutputChannel().show(true)

            this.updateTreeViewMessage(0)

            return []
        }
    }

    private processJscpdReport(reportJson: string, args: string[], execError: Error | undefined): DuplicatedCode[] {
        const report = JSON.parse(reportJson) as {duplicates: JscpdClone[]}
        const rawClones = report.duplicates ?? []

        // Dedupe clones that jscpd may report twice (A->B and B->A)
        const seen = new Set<string>()
        const clones = rawClones.filter((c) => {
            const key = normalizeCloneKey(c)

            if (seen.has(key)) {
                return false
            }

            seen.add(key)

            return true
        })

        this.clones = clones
        const len = clones.length

        if (execError) {
            // Non-zero exit with a valid report — jscpd's threshold gate tripped, but we have results.
            getOutputChannel().appendLine(`jscpd reported threshold exceeded (non-zero exit), but ${len} clone(s) parsed from report`)
        } else {
            getOutputChannel().appendLine(`Scanned ${report.statistics?.total?.sources ?? '?'} files — found ${len} unique clone(s)`)
        }

        if (len === 0) {
            getOutputChannel().appendLine(`Command: ${jscpdBin} ${args.join(' ')}`)
        }

        this.updateTreeViewMessage(len)

        return clones
            .sort((a, b) => {
                const byFile = a.firstFile.name.localeCompare(b.firstFile.name)

                return byFile !== 0 ? byFile : a.firstFile.start - b.firstFile.start
            })
            .map(
                (clone, index) => new DuplicatedCode(
                    index,
                    clone,
                    DuplicatedCodeType.line,
                    undefined,
                    vscode.TreeItemCollapsibleState.None,
                ),
            )
    }

    private updateTreeViewMessage(count: number): void {
        if (this.treeView) {
            this.treeView.message = count === 0
                ? 'No duplicates found'
                : `(${count}) duplicate${count === 1 ? '' : 's'}`
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }
}
