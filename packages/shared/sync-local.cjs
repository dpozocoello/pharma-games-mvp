const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const targets = [
  path.join(root, 'node_modules/@pharma/shared'),
  path.join(root, 'apps/api/node_modules/@pharma/shared'),
  path.join(root, 'apps/pwa/node_modules/@pharma/shared'),
  path.join(root, 'apps/admin/node_modules/@pharma/shared'),
  path.join(root, 'packages/game-sdk/node_modules/@pharma/shared'),
];

for (const dest of targets) {
  try {
    fs.mkdirSync(path.join(dest, 'dist'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'src'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'package.json'), path.join(dest, 'package.json'));
    for (const f of fs.readdirSync(path.join(__dirname, 'dist'))) {
      fs.copyFileSync(path.join(__dirname, 'dist', f), path.join(dest, 'dist', f));
    }
    for (const f of fs.readdirSync(path.join(__dirname, 'src'))) {
      fs.copyFileSync(path.join(__dirname, 'src', f), path.join(dest, 'src', f));
    }
  } catch {
    // Ignore if target does not exist
  }
}
