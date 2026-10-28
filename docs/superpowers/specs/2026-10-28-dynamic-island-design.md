# Dynamic Island overlay — design (MVP)

Date: 2026-10-28

## Goal

An always-on-top overlay at the top-center of the screen, styled after Apple's
Dynamic Island. The MVP is **UI/UX only**: the island shell, its states and
animations, and a module system that future data sources (e.g. GitLab
pipelines) plug into. Module content uses mock data and does nothing real.

## Stack

Electron, plain HTML/CSS/JS (no framework, no build step). Windows 11.

## Layout

```
island/
  main.js                  window, positioning, click-through, tray, IPC
  preload.js               window.island bridge
  main/providers/          main-process data providers (network, tokens live here)
    index.js               registry
    pipelines.mock.js      emits fake pipeline statuses
  renderer/
    index.html, island.css
    island.js              shell: states, hover intent, module switching
    modules/
      index.js             registry (order = priority)
      media.js             mock "Now Playing"
      pipelines.js         renders pipeline data from its provider
```

## Module contract

Renderer module:

```js
export default {
  id: 'pipelines',            // matches the provider id, if any
  title: 'Pipelines',
  expandedHeight: 170,         // px
  setup({ left, right, body, changed }) {}, // build DOM once into the given slots
  hasActivity() { return true },            // false → module has nothing to show
  onData(data) {},                          // payload from the main-process provider
}
```

Main-process provider: `{ id, start(emit) → stop }`. `emit(data)` reaches the
renderer module with the same `id` via `onData`.

## Island states

| State    | Size     | Shows |
|----------|----------|-------|
| idle     | 120×32   | empty pill (no module has activity) |
| compact  | 230×36   | module's left / right "ears" |
| expanded | 400×N    | module body + dots to switch modules |

- Hover (120 ms intent delay) or click → expand; leave → collapse after 350 ms.
- Mouse wheel / dots switch modules. Right-click → menu (Quit).
- Springy morph of width/height/radius; content fades in with blur.
- Empty window area is click-through; only the pill captures the mouse.

## Out of scope

Real media/GitLab data, autostart, multi-monitor, settings.
