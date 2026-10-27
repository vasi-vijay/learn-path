const fs = require('fs');

const content = fs.readFileSync('public/vendor/bundle.js', 'utf8');

// 1. Extract CS Notes from gT
const startNotes = content.indexOf('gT=[');
const endNotes = content.indexOf('];', startNotes);
const jsonNotes = content.slice(startNotes + 3, endNotes + 1);

// Extract resume templates
// Let us search for the resume template array
const resumeIdx = content.indexOf('15q1IynZHQV1rZbtLAXontQe3ABlg2Z6D');
console.log('Resume template snippet:');
console.log(content.slice(Math.max(0, resumeIdx - 400), Math.min(content.length, resumeIdx + 1200)));
