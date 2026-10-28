// Main-process data providers. Each one is { id, start(emit) -> stop }.
// emit(data) is delivered to the renderer module with the same id (module.onData).
// Network calls and secrets (e.g. a GitLab token) belong here, not in the renderer.
module.exports = [
  require('./agents'),
  // require('./pipelines.mock'), // disabled until GitLab is wired
];
