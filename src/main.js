const basePath = process.cwd();
const { NETWORK } = require(`${basePath}/constants/network.js`);
const fs = require("fs");
const sha1 = require(`${basePath}/node_modules/sha1`);
const { createCanvas, loadImage } = require(`${basePath}/node_modules/canvas`);
const buildDir = `${basePath}/build`;
const layersDir = `${basePath}/layers`;
const rarities = require(`${basePath}/config/rarities.json`);

const {
  format,
  baseUri,
  description,
  background,
  uniqueDnaTorrance,
  layerConfigurations,
  rarityDelimiter,
  shuffleLayerConfigurations,
  debugLogs,
  extraMetadata,
  text,
  namePrefix,
  network,
  solanaMetadata,
  gif,
} = require(`${basePath}/src/config.js`);
const canvas = createCanvas(format.width, format.height);
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = format.smoothing;
var metadataList = [];
var attributesList = [];
var dnaList = new Set();
const DNA_DELIMITER = "*";
const HashlipsGiffer = require(`${basePath}/modules/HashlipsGiffer.js`);

let hashlipsGiffer = null;

const buildSetup = async () => {
  if (fs.existsSync(buildDir)) {
    fs.rmdirSync(buildDir, { recursive: true });
  }
  await fs.mkdirSync(buildDir);
  await fs.mkdirSync(`${buildDir}/json`);
  await fs.mkdirSync(`${buildDir}/images`);
  if (gif.export) {
    fs.mkdirSync(`${buildDir}/gifs`);
  }
};

const getRarityWeight = (_str) => {
  let nameWithoutExtension = _str.slice(0, -4);
  var nameWithoutWeight = Number(
    nameWithoutExtension.split(rarityDelimiter).pop()
  );
  if (isNaN(nameWithoutWeight)) {
    nameWithoutWeight = -1;
  }
  return nameWithoutWeight;
};

const cleanDna = (_str) => {
  const withoutOptions = removeQueryStrings(_str);
  var dna = Number(withoutOptions.split(":").shift());
  return dna;
};

const cleanName = (_str) => {
  let nameWithoutExtension = _str.slice(0, -4);
  var nameWithoutWeight = nameWithoutExtension.split(rarityDelimiter).shift();
  return nameWithoutWeight;
};

const getElements = (path) => {
  return fs
    .readdirSync(path)
    .filter((item) => !/(^|\/)\.[^\/\.]/g.test(item))
    .map((i, index) => {
      // if (i.includes("-")) {
      //   throw new Error(`layer name can not contain dashes, please fix: ${i}`);
      // }
      return {
        id: index,
        name: cleanName(i),
        filename: i,
        path: `${path}${i}`,
        weight: getRarityWeight(i),
      };
    });
};

const layersSetup = (layersOrder) => {
  const layers = layersOrder.map((layerObj, index) => ({
    id: index,
    elements: getElements(`${layersDir}/${layerObj.name}/`),
    name:
      layerObj.options?.["displayName"] != undefined
        ? layerObj.options?.["displayName"]
        : layerObj.name,
    blend:
      layerObj.options?.["blend"] != undefined
        ? layerObj.options?.["blend"]
        : "source-over",
    opacity:
      layerObj.options?.["opacity"] != undefined
        ? layerObj.options?.["opacity"]
        : 1,
    bypassDNA:
      layerObj.options?.["bypassDNA"] !== undefined
        ? layerObj.options?.["bypassDNA"]
        : false,
  }));
  return layers;
};

const saveImage = (_editionCount) => {
  fs.writeFileSync(
    `${buildDir}/images/${_editionCount}.png`,
    canvas.toBuffer("image/png")
  );
};

const addMetadata = (_dna, _edition) => {
  let tempMetadata = {
    name: `${namePrefix} #${_edition}`,
    image: `${baseUri}/${_edition}.png`,
    description: description,
    attributes: attributesList,
  };
  metadataList.push(tempMetadata);
  attributesList = [];
};

const addAttributes = (_element) => {
  let selectedElement = _element.layer.selectedElement;
  attributesList.push({
    trait_type: _element.layer.name.slice(3),
    value: selectedElement.name,
  });
};

const loadLayerImg = async (_layer) => {
  try {
    return new Promise(async (resolve) => {
      const image = await loadImage(`${_layer.selectedElement.path}`);
      resolve({ layer: _layer, loadedImage: image });
    });
  } catch (error) {
    console.error("Error loading image:", error);
  }
};

const addText = (_sig, x, y, size) => {
  ctx.fillStyle = text.color;
  ctx.font = `${text.weight} ${size}pt ${text.family}`;
  ctx.textBaseline = text.baseline;
  ctx.textAlign = text.align;
  ctx.fillText(_sig, x, y);
};

const drawElement = (_renderObject, _index, _layersLen) => {
  ctx.globalAlpha = _renderObject.layer.opacity;
  ctx.globalCompositeOperation = _renderObject.layer.blend;
  text.only
    ? addText(
      `${_renderObject.layer.name}${text.spacer}${_renderObject.layer.selectedElement.name}`,
      text.xGap,
      text.yGap * (_index + 1),
      text.size
    )
    : ctx.drawImage(
      _renderObject.loadedImage,
      0,
      0,
      format.width,
      format.height
    );

  addAttributes(_renderObject);
};

const constructLayerToDna = (_dna = "", _layers = []) => {
  // console.log(_dna);
  let mappedDnaToLayers = _layers.map((layer, index) => {
    let selectedElement = layer.elements.find(
      (e) => e.id == cleanDna(_dna.split(DNA_DELIMITER)[index])
    );
    return {
      name: layer.name,
      blend: layer.blend,
      opacity: layer.opacity,
      selectedElement: selectedElement,
    };
  });
  return mappedDnaToLayers;
};

/**
 * In some cases a DNA string may contain optional query parameters for options
 * such as bypassing the DNA isUnique check, this function filters out those
 * items without modifying the stored DNA.
 *
 * @param {String} _dna New DNA string
 * @returns new DNA string with any items that should be filtered, removed.
 */
const filterDNAOptions = (_dna) => {
  const dnaItems = _dna.split(DNA_DELIMITER);
  const filteredDNA = dnaItems.filter((element) => {
    const query = /(\?.*$)/;
    const querystring = query.exec(element);
    if (!querystring) {
      return true;
    }
    const options = querystring[1].split("&").reduce((r, setting) => {
      const keyPairs = setting.split("=");
      return { ...r, [keyPairs[0]]: keyPairs[1] };
    }, []);

    return options.bypassDNA;
  });

  return filteredDNA.join(DNA_DELIMITER);
};

/**
 * Cleaning function for DNA strings. When DNA strings include an option, it
 * is added to the filename with a ?setting=value query string. It needs to be
 * removed to properly access the file name before Drawing.
 *
 * @param {String} _dna The entire newDNA string
 * @returns Cleaned DNA string without querystring parameters.
 */
const removeQueryStrings = (_dna) => {
  const query = /(\?.*$)/;
  return _dna.replace(query, "");
};

const isDnaUnique = (_DnaList = new Set(), _dna = "") => {
  const _filteredDNA = filterDNAOptions(_dna);
  return !_DnaList.has(_filteredDNA);
};

const createDna = (_layers) => {
  let randNum = [];
  _layers.forEach((layer) => {
    var totalWeight = 0;
    layer.elements.forEach((element) => {
      totalWeight += element.weight;
    });
    // number between 0 - totalWeight
    let random = Math.floor(Math.random() * totalWeight);
    for (var i = 0; i < layer.elements.length; i++) {
      // subtract the current weight from the random weight until we reach a sub zero value.
      random -= layer.elements[i].weight;
      if (random < 0) {
        return randNum.push(
          `${layer.elements[i].id}:${layer.elements[i].filename}${layer.bypassDNA ? "?bypassDNA=true" : ""
          }`
        );
      }
    }
  });
  return randNum.join(DNA_DELIMITER);
};

const writeMetaData = (_data) => {
  fs.writeFileSync(`${buildDir}/json/_metadata.json`, _data);
};

const saveMetaDataSingleFile = (_editionCount) => {
  let metadata = metadataList.find((meta) => meta.name.split(rarityDelimiter).pop() == _editionCount);
  debugLogs
    ? console.log(
      `Writing metadata for ${_editionCount}: ${JSON.stringify(metadata)}`
    )
    : null;
  fs.writeFileSync(
    `${buildDir}/json/${_editionCount}.json`,
    JSON.stringify(metadata, null, 2)
  );
};

function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;
  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
  return array;
}

const getRandomInRange = (n) => {
  return parseInt(Math.random() * n);
}

const getProperTraitsFromLayers = (totalCount, layers) => {
  let traits = [];
  const layerCount = layers.length;
  for (let i = 0; i < layerCount; i++) {
    traits[i] = [];
    let name = layers[i].name.slice(3);
    let keys = []; // for additional
    Object.keys(rarities[name]).forEach(key => {
      let count = parseInt(totalCount * rarities[name][key] / 100);
      for (let j = 0; j < count; j++) traits[i].push(key + ".png");
      keys.push(key + ".png");
    });
    let count = Math.max(0, totalCount - traits[i].length);
    for (let j = 0; j < count; j++) traits[i].push(keys[getRandomInRange(keys.length)]);
    // for safety
    traits[i] = traits[i].slice(0, totalCount);
    traits[i].sort((a, b) => Math.random() - 0.5);
  }

  while (true) {
    // check there is any mismatch
    let good = true;
    for (let i = 0; i < totalCount; i++) {
      // 3. Body, 4. Head
      let heavyBody =
        traits[3][i].toLowerCase().includes("hoodie") ||
        traits[3][i].toLowerCase().includes("tron") ||
        traits[3][i].toLowerCase().includes("helmet");
      let heavyHead =
        traits[4][i].toLowerCase().includes("hoodie") ||
        traits[4][i].toLowerCase().includes("tron") ||
        traits[4][i].toLowerCase().includes("helmet");
      let isFace = !traits[5][i].toLowerCase().includes("none");

      if (heavyBody && (heavyHead || isFace)) { // mismatch on body and head
        let j = getRandomInRange(totalCount);
        // swap
        let tmp = traits[4][i];
        traits[4][i] = traits[4][j];
        traits[4][j] = tmp;
        good = false;
      }
      if (heavyHead && isFace) { // mismatch head and face
        let j = getRandomInRange(totalCount);
        // swap
        let tmp = traits[5][i];
        traits[5][i] = traits[5][j];
        traits[5][j] = tmp;
        good = false;
      }
    }
    if (good) break;
  }
  // remove .png from None
  for (let i = 0; i < layerCount; i++)
    for (let j = 0; j < totalCount; j++)
      if (traits[i][j].toLowerCase().includes("none")) traits[i][j] = "None";
  return traits;
}

const saveTraitsAnalysis = (traits, layers, totalCount) => {
  let result = {};
  const layerCount = layers.length;

  for (let i = 0; i < layerCount; i++) {
    let cur = {};
    for (let j = 0; j < totalCount; j++) {
      if (!cur[traits[i][j]]) cur[traits[i][j]] = 0;
      cur[traits[i][j]]++;
    }
    result[layers[i].name] = cur;
  }
  fs.writeFileSync(`${buildDir}/traits.json`, JSON.stringify(result));
}

const startCreating = async () => {
  let totalCount = layerConfigurations[0].growEditionSizeTo;
  const layers = layersSetup(layerConfigurations[0].layersOrder);

  let traits = getProperTraitsFromLayers(totalCount, layers);
  saveTraitsAnalysis(traits, layers, totalCount);
  // generate all art's dna
  for (let id = 1; id <= totalCount; id++) {
    let newDna = layers
      .map((layer, i) => {
        let filenames = layer.elements.map(item => item.filename);
        let filename = traits[i][id - 1];
        let pos = filenames.indexOf(filename);
        if (pos < 0 && filename != "None") console.log("**************", layer.name, filename);
        return pos + ":" + filename;
      })
      .join(DNA_DELIMITER);
    // console.log(newDna);
    let results = constructLayerToDna(newDna, layers);
    let loadedElements = [];

    results.forEach((layer, i) => {
      if (layer.selectedElement && layer.selectedElement.name != "None") {
        // if ((i == 2 || i == 4) && Math.random() < 0.2) return;
        loadedElements.push(loadLayerImg(layer));
      }
    });

    await Promise.all(loadedElements).then((renderObjectArray) => {
      ctx.clearRect(0, 0, format.width, format.height);
      renderObjectArray.forEach((renderObject, index) => {
        drawElement(
          renderObject,
          index,
          layerConfigurations[0].layersOrder.length
        );
      });
      saveImage(id);
      addMetadata(newDna, id);
      saveMetaDataSingleFile(id);
      console.log(`Created edition: ${id}, with DNA: ${sha1(newDna)}`);
    });
  }
};

module.exports = { startCreating, buildSetup, getElements };
