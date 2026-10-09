// hls.js and mpegts.js are loaded by the renderer as plain <script> tags
// (renderer/index.html), so the bundles ship as committed copies under
// renderer/lib instead of being required from node_modules. Nothing in npm's
// own machinery ties those copies to the installed versions, so this list is
// the single source for both the copy step and the drift test.
const path = require('path');

class PatchNotApplicableError extends Error {}

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
    patches: [
      {
        // Cap silent-frame gap filling at 10 s (o is the gap in ms, d one
        // audio frame). Uncapped, a provider whose audio clock jumps by hours
        // makes the remuxer build millions of frames and overflow the stack.
        // Off entirely, mpegts.js packs audio back to back across a real gap
        // while video keeps its timestamps, and the sound runs ahead of the
        // picture by the gap's length. Larger gaps still collapse as before.
        find: 'o>=3*d&&this._fillAudioTimestampGap',
        replace: 'o>=3*d&&o<=1e4&&this._fillAudioTimestampGap',
      },
    ],
  },
];

// The bundles are minified, so patches are exact string replacements. Each
// target must occur exactly once: a new upstream build that moves or renames
// the code fails the sync loudly instead of shipping the bundle unpatched.
function applyPatches(lib, text) {
  let result = text;
  for (const { find, replace } of lib.patches ?? []) {
    const occurrences = result.split(find).length - 1;
    if (occurrences !== 1) {
      throw new PatchNotApplicableError(
        `${lib.name}: expected patch target once, found ${occurrences}: ${find}`
      );
    }
    result = result.replace(find, () => replace);
  }
  return result;
}

module.exports = { PLAYER_LIBS, applyPatches, PatchNotApplicableError };
