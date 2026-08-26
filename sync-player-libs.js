// Run before every start and build so the committed bundles under renderer/lib
// cannot fall behind the versions npm installed. player-libs.test.js fails if
// they ever do.
const fs = require('fs');
const { PLAYER_LIBS } = require('./player-libs.js');

for (const lib of PLAYER_LIBS) {
  fs.copyFileSync(lib.source, lib.vendored);
  console.log(`synced renderer/lib/${lib.name}`);
}
