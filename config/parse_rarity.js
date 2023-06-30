const layer = "Color";

const str = `Bubble Gum	0.20%
Cigar	0.10%
Clown Nose	0.10%
Lolipop	0.10%
Mustache	0.10%
Nose Ring	0.10%
Party Whistle	0.10%
Pipe	0.20%
Tongue out	0
Whistle Note	1%
Zombie Face	1%
None	97%`;

let traits = str.split("\n");

let result = {};

for (let trait of traits) result[trait.split("\t")[0]] = Number(trait.split("\t")[1].slice(0, -1));
console.log(JSON.stringify(result));
