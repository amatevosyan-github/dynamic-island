// Island modules, in priority order: when the picked module has nothing to show,
// the island falls back to the first module that does.
//
// Module contract:
//   id               matches a main-process provider id (main/providers) if it receives data
//   title            shown as the dot tooltip
//   expandedHeight   island height in px when expanded
//   setup({ left, right, body, changed })
//                    build DOM once: left/right are the compact "ears", body is the expanded view.
//                    call changed() after updating; changed({ attention: true }) briefly
//                    brings the module forward with a pulse.
//   hasActivity()    false → module has nothing to show right now
//   onData(data)     optional, payload from the provider with the same id
import agents from './agents.js';
// import media from './media.js'; // mock, disabled for now
// import pipelines from './pipelines.js'; // mock data, disabled until GitLab is wired

export default [agents /* , media, pipelines */];
