// Main-process data providers. Each one is { id, start(emit, ctx) -> stop, command? }.
// emit(data) is delivered to the renderer module with the same id (module.onData);
// command(name, payload) receives window.island.command(id, name, payload) from it.
// ctx: { config, notify(title, body, url), open(url), popupMenu(template) }.
// Network calls and secrets (e.g. a GitLab token) belong here, not in the renderer.
module.exports = [
  require('./agents'),
  require('./gitlab'),
  // require('./pipelines.mock'), // fake pipelines for UI work
];
