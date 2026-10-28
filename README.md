# vistry-utils

## Island

A Dynamic Island–style overlay pinned to the top center of the screen. It shows:

- **Agents**: your Claude Code and Cursor chats and whether each is working, done or
  waiting for you. Clicking a Claude chat opens it in the Claude desktop app.
- **Pipelines**: the latest GitLab pipeline of each project you list.

The island is built from modules, so other sources can be added next to these.

### Install

**Installer.** Run `Vistry Island Setup <version>.exe` (built with `npm run dist`, see
below). On first start the island offers to install the agent hooks. Windows may show
a SmartScreen warning because the installer isn't code-signed.

**From source:**

```bash
cd island
npm install        # downloads Electron (~100 MB) on first run
npm run setup-hooks
npm start
```

Requirements: Windows 10/11, Node.js 18+ on `PATH` (the agent hooks run `node`, also
with the installer), and Claude Code (CLI or the Claude desktop app's Code tab) and/or
Cursor.

### Agent hooks

The hooks are how the island learns about your chats. `npm run setup-hooks` (or
**Install agent hooks…** in the tray menu) adds them to `~/.claude/settings.json` and,
if Cursor is installed, to `~/.cursor/hooks.json`. Your other settings and hooks are
kept, a `.bak` copy is written first, and running it again is safe. Restart Cursor
afterwards so it loads its hooks.

From source the hooks point at the checkout by absolute path, so re-run
`npm run setup-hooks` after moving the folder. The installed app copies the hook script
to `~/.vistry-island/hooks/` instead.

To remove them: `npm run remove-hooks`, or **Remove agent hooks** in the tray menu.

### Using it

- Hover or click the pill to expand it; it collapses when the pointer leaves.
- Click a chat row to open it: Claude chats open in the Claude desktop app, Cursor rows
  bring up that workspace's window. Right-click a row to hide it until it changes.
- Click a pipeline row to open it in GitLab.
- When something finishes or asks you something, the island pulses for a moment.
- Scroll over the island or click the dots to switch between modules that have data.
- The time on a chat row is how long it has been in its current state.

The tray menu (click the tray icon or right-click the island) has: launch at startup,
notifications (Windows toasts when a chat needs you or finishes, or a pipeline passes or
fails; off by default), hide in full screen (on by default: videos, games,
presentations), the hooks, the settings file, and Quit.

### Settings and GitLab

Settings live in `~/.vistry-island/config.json` (tray menu → **Open settings file**);
the island picks up changes when you save. To show pipelines, fill in `gitlab`:

```json
{
  "gitlab": {
    "url": "https://gitlab.com",
    "token": "glpat-…",
    "projects": ["my-group/web", "my-group/api"],
    "ref": ""
  }
}
```

- `token`: a personal or project access token with only the `read_api` scope. It is
  stored in this file as plain text, so don't use a token with write access.
- `projects`: full project paths as in the GitLab URL.
- `ref`: a branch to follow; empty means the latest pipeline on any branch.

Pipelines are checked every minute, and every 15 seconds while one is running.

### What is stored

Each chat is one small JSON file in `~/.vistry-island/agents/`: the project folder,
the first ~100 characters of the latest prompt, the agent's last question and the
state. To tell "done" from "waiting for you", the hook reads the tail of that chat's
transcript on your machine. Files of finished chats are deleted after a day. Nothing is
sent anywhere except the GitLab API requests to the `url` you configure.

### Limitations

- Windows only for now: chat titles and click-to-open read the Claude desktop app's
  local session list at Windows paths, and full-screen detection uses Windows APIs.
- **Click-to-open** uses the Claude app's own `claude://code/continue` link, so it
  depends on the app version.
- **Claude Code in a terminal** is listed but can't be opened by click.
- **Cursor** can't open a specific chat by link; the click only focuses the workspace.
  Cursor chats are titled with their first request.
- **"Waiting for you"** is detected when a reply ends with a question (or a permission
  prompt in Claude). A reply that merely ends with a rhetorical question also counts.
- Chats on claude.ai (outside Claude Code) are not tracked.

### Development

```bash
npm test      # hook script, question detection and the hooks installer
npm run dist  # Windows installer in island/dist/
```

A module is a renderer file in `island/renderer/modules/` registered in
`modules/index.js`; the contract is documented at the top of that file. Data that needs
the network or a token comes from a provider in `island/main/providers/` with the same
`id` (contract in `providers/index.js`). The disabled `media` module and
`pipelines.mock.js` are examples with fake data.
