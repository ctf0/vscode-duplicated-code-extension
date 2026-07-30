# duplicated-code

VSCode extension for the copy/paste detector using [jscpd](https://github.com/kucherenko/jscpd)

Detects code duplication in a project.

based on https://github.com/paulomenezes/vscode-duplicated-code-extension + [Enhancements](./CHANGELOG.md)

## Features

- we now use jscpd v5
- we use the project `.jscpd.json` if found or fallback to extension config
- refresh list on config changes
