const fs = require('node:fs')
const raw = fs.readFileSync(process.argv[2], 'utf8')
const list = JSON.parse(raw)
for (const p of list) console.log(p.sourceId, p.enabled, p.collectionPreset)
