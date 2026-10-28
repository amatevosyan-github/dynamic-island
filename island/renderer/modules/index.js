// Island modules, in priority order: when the picked module has nothing to show,
// the island falls back to the first module that does.
//
// Module contract:
//   id               matches a main-process provider id (main/providers) if it receives data
//   title            shown as the dot tooltip
//   expandedHeight   island height in px when expanded
//   setup({ left, right, body, satellite, changed })
//                    build DOM once: left/right are the compact "ears", body is the expanded view,
//                    satellite is an optional round badge shown beside the island.
//                    call changed() after updating; changed({ attention: true }) briefly
//                    brings the module forward with a pulse.
//   hasActivity()    false → module has nothing to show right now
//   alwaysListed     optional: keep the module in the dots even without activity
//   satelliteVisible() optional: show the badge (hidden while the module itself is on screen)
//   badgeWhenCollapsed optional: collapsed, leave the pill to other modules and show the badge
//   onData(data)     optional, payload from the provider with the same id
import agents from './agents.js';
// import media from './media.js'; // mock, disabled for now
import pipelines from './pipelines.js'; // GitLab, see main/providers/gitlab.js
import timer from './timer.js';

export default [agents, /* media, */ pipelines, timer];
