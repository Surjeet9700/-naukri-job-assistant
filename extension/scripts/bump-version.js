const fs = require('fs');
const path = require('path');

// Read and parse JSON files
const manifestPath = path.join(__dirname, '../manifest.json');
const packagePath = path.join(__dirname, '../package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const package = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Get current version
const currentVersion = manifest.version;
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Bump patch version
const newVersion = `${major}.${minor}.${patch + 1}`;

// Update version in both files
manifest.version = newVersion;
package.version = newVersion;

// Write back to files
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
fs.writeFileSync(packagePath, JSON.stringify(package, null, 2));

console.log(`Version bumped from ${currentVersion} to ${newVersion}`); 