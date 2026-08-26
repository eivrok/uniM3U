// hls.js and mpegts.js are loaded by the renderer as plain <script> tags
// (renderer/index.html), so the bundles ship as committed copies under
// renderer/lib instead of being required from node_modules. Nothing in npm's
// own machinery ties those copies to the installed versions, so this list is
// the single source for both the copy step and the drift test.
const path = require('path');

const PLAYER_LIBS = [
  {
    name: 'hls.min.js',
    source: path.join(__dirname, 'node_modules', 'hls.js', 'dist', 'hls.min.js'),
    vendored: path.join(__dirname, 'renderer', 'lib', 'hls.min.js'),
  },
  {
    name: 'mpegts.js',
    source: path.join(__dirname, 'node_modules', 'mpegts.js', 'dist', 'mpegts.js'),
    vendored: path.join(__dirname, 'renderer', 'lib', 'mpegts.js'),
  },
];

module.exports = { PLAYER_LIBS };
