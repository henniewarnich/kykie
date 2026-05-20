// Refuse to build if package.json.version and src/utils/constants.js APP_VERSION
// don't agree. The footer reads APP_VERSION; bumping only one of the two ships
// the new code under the old version string. Wired in as `prebuild`.

import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const constants = readFileSync('src/utils/constants.js', 'utf8');
const m = constants.match(/APP_VERSION\s*=\s*["']([^"']+)["']/);

if (!m) {
  console.error('check-version-sync: could not find APP_VERSION in src/utils/constants.js');
  process.exit(1);
}

if (m[1] !== pkg.version) {
  console.error('');
  console.error('  Version mismatch — refusing to build.');
  console.error(`    package.json           = ${pkg.version}`);
  console.error(`    constants.APP_VERSION  = ${m[1]}`);
  console.error('  Bump BOTH to the same value before building.');
  console.error('');
  process.exit(1);
}

console.log(`✓ version sync ok: ${pkg.version}`);
