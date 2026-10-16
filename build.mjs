// Builds two single-file pages from src/:
//   index.html             standalone game, three.js bundled in (works offline)
//   dist/shredline.html    page body for hosting where three.js loads from a CDN
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const THREE_VERSION = '0.149.0';
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.min.js`;

const threeGlobal = {
  name: 'three-global',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'three-global' }));
    b.onLoad({ filter: /.*/, namespace: 'three-global' }, () => ({ contents: 'module.exports = window.THREE;', loader: 'js' }));
  },
};

async function bundle(external) {
  const res = await build({
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: true,
    write: false,
    legalComments: 'none',
    plugins: external ? [threeGlobal] : [],
  });
  let code = res.outputFiles[0].text;
  // keep the HTML parser out of the script body
  code = code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  return code;
}

const page = readFileSync('src/page.html', 'utf8');
const split = page.indexOf('<div id="app">');
const head = page.slice(0, split).trim();
const body = page.slice(split).replace('<!--SCRIPTS-->', '').trim();

const [inlineAll, inlineApp] = await Promise.all([bundle(false), bundle(true)]);

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Shredline: a 3D snowboard park game. Spins, corks, grabs, rails, a superpipe and Big Air.">
<meta name="theme-color" content="#081224">
${head}
</head>
<body>
${body}
<script>${inlineAll}</script>
</body>
</html>
`;
writeFileSync('index.html', standalone);

mkdirSync('dist', { recursive: true });
const hosted = `${head}
${body}
<script src="${THREE_CDN}"></script>
<script>${inlineApp}</script>
`;
writeFileSync('dist/shredline.html', hosted);

const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`index.html          ${kb(standalone)}`);
console.log(`dist/shredline.html ${kb(hosted)}`);
