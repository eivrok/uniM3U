// Run before every start and build so the committed bundles under renderer/lib
// cannot fall behind the versions npm installed. player-libs.test.js fails if
// they ever do.
const fs = require('fs');
const { PLAYER_LIBS, applyPatches } = require('./player-libs.js');

for (const lib of PLAYER_LIBS) {
  const source = fs.readFileSync(lib.source, 'utf8');
  fs.writeFileSync(lib.vendored, applyPatches(lib, source));
  console.log(`synced renderer/lib/${lib.name}`);
}
