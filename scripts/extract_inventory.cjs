const fs = require('fs');

const content = fs.readFileSync('public/vendor/bundle.js', 'utf8');

// Notes
const startNotes = content.indexOf('gT=[');
const endNotes = content.indexOf('];', startNotes);
const jsonNotes = content.slice(startNotes + 3, endNotes + 1);
const notes = eval('(' + jsonNotes + ')');
console.log(`Extracted ${notes.length} Study Notes.`);

// Resumes
const startResumes = content.indexOf('bT=[');
const endResumes = content.indexOf('];', startResumes);
const jsonResumes = content.slice(startResumes + 3, endResumes + 1);
function yT(url) {
  const m = url.match(/drive\.google\.com\/file\/d\/([^\/\?]+)/);
  return m ? `https://drive.google.com/file/d/${m[1]}/preview` : url;
}
const resumes = eval('(' + jsonResumes + ')');
console.log(`Extracted ${resumes.length} Resume Templates.`);

console.log('\n--- 1. CS STUDY NOTES INVENTORY ---');
notes.forEach((n, idx) => {
  const driveId = n.file_url.match(/d\/([^\/\?]+)/)?.[1];
  console.log(`${idx + 1}. [${n.category}] "${n.title}"`);
  console.log(`   Drive File ID: ${driveId}`);
  console.log(`   File URL: ${n.file_url}`);
  console.log(`   Preview URL: ${n.preview_url}`);
  console.log(`   Internal ID: ${n.id}`);
});

console.log('\n--- 2. RESUME TEMPLATES INVENTORY ---');
resumes.forEach((r, idx) => {
  const driveId = r.link.match(/d\/([^\/\?]+)/)?.[1];
  console.log(`${idx + 1}. [${r.category}] "${r.name}"`);
  console.log(`   Drive File ID: ${driveId}`);
  console.log(`   Drive Link: ${r.link}`);
  console.log(`   Preview URL: ${r.previewUrl}`);
  console.log(`   Internal ID: ${r.id}`);
});

// Check if any other Google Drive links exist outside gT and bT
const allDriveLinks = content.match(/https:\/\/drive\.google\.com\/[^\s"'`<>]+/g) || [];
const recordedIds = new Set([
  ...notes.map(n => n.file_url.match(/d\/([^\/\?]+)/)?.[1]),
  ...resumes.map(r => r.link.match(/d\/([^\/\?]+)/)?.[1])
]);

console.log('\n--- 3. OTHER GOOGLE DRIVE LINKS ---');
allDriveLinks.forEach(link => {
  const fileId = link.match(/d\/([^\/\?]+)/)?.[1];
  if (!recordedIds.has(fileId)) {
    console.log('Other link:', link);
  }
});
