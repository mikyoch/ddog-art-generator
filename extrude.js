const fs = require("fs");

const assets = fs.readdirSync("./layers/2. Color");

for (let item of assets) console.log(item.slice(0, -4));