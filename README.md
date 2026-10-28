# vistry-utils

## Island

A Dynamic Island–style overlay pinned to the top center of the screen. It shows the
state of your AI agent chats (Claude Code and Cursor): which are working, which are
done and which are waiting for you. Clicking a Claude chat opens it in the Claude
desktop app.

The island is built from modules, so other sources (e.g. GitLab pipelines) can be
added next to the agents one.

### Requirements

- Windows 10/11 (see [Limitations](#limitations) for macOS)
- Node.js 18+ on `PATH` (the hooks run `node`)
- Claude Code (CLI or the Claude desktop app's Code tab) and/or Cursor

### Run

```bash
cd island
npm install        # downloads Electron (~100 MB) on first run
npm run setup-hooks
npm start
```

`npm run setup-hooks` adds the status hooks to `~/.claude/settings.json` and, if Cursor
is installed, to `~/.cursor/hooks.json`. It keeps your existing settings and hooks,
writes a `.bak` copy first, and is safe to run again. Re-run it if you move the
project folder, because the hooks point to the script by absolute path. Restart
Cursor afterwards so it loads its hooks.

To remove the hooks:

```bash
npm run remove-hooks
```

Quit the island from the tray icon or by right-clicking it.

### Using it

- Hover or click the pill to expand it; it collapses when the pointer leaves.
- Click a chat row to open it: Claude chats open in the Claude desktop app, Cursor
  rows bring up that workspace's window.
- When a chat finishes or asks you something, the island pulses for a moment.
- With several modules, scroll over the island or click the dots to switch.

### What the hooks store

Each chat is one small JSON file in `~/.vistry-island/agents/`: the project folder,
the first ~100 characters of the latest prompt, the agent's last question and the
state. To tell "done" from "waiting for you", the hook reads the tail of that chat's
transcript on your machine. Nothing is sent anywhere.

### Limitations

- **Chat titles and click-to-open** read the Claude desktop app's local session list,
  which is only looked up at Windows paths. On macOS the chats still show up, but
  without titles and without click-to-open.
- **Click-to-open** uses the Claude app's own `claude://code/continue` link, so it
  depends on the app version.
- **Claude Code in a terminal** is listed but can't be opened by click.
- **Cursor** can't open a specific chat by link; the click only focuses the workspace.
- **"Waiting for you"** is detected when a reply ends with a question (or a permission
  prompt in Claude). A reply that merely ends with a rhetorical question also counts.
- Chats on claude.ai (outside Claude Code) are not tracked.

### Adding a module

A module is a renderer file in `island/renderer/modules/` registered in
`modules/index.js`; the contract is documented at the top of that file. Data that
needs the network or a token comes from a provider in `island/main/providers/` with
the same `id`. The disabled `media` and `pipelines` modules are examples.
