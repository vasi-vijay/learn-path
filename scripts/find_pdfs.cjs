const fs = require('fs');

const content = fs.readFileSync('public/vendor/bundle.js', 'utf8');

// 1. Find all drive.google.com links
const driveRegex = /https:\/\/drive\.google\.com\/[^\s"'`<>]+/g;
let m;
const driveLinks = new Set();
while ((m = driveRegex.exec(content)) !== null) {
  driveLinks.add(m[0]);
}

console.log(`Found ${driveLinks.size} unique Google Drive links:`);
const linksArray = Array.from(driveLinks);
linksArray.forEach((link, idx) => {
  console.log(`${idx + 1}. ${link}`);
});

// 2. Find file IDs from drive links
const fileIds = new Set();
for (const link of linksArray) {
  const match = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    fileIds.add(match[1]);
  }
}
console.log(`\nUnique Google Drive File IDs: ${fileIds.size}`);
