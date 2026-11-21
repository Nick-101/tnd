// 화면·엔진·데이터를 HTML 한 파일로 묶는다. 쓰는 법: node build-single.mjs → dist/yolodwarf-single.html
// 웹에 올리는 용도다. 묶은 파일은 <html>/<body> 없이 내용만 담는다(올리는 곳이 감싼다. 브라우저로 직접 열어도 된다).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(root, f), 'utf8');
const strip = src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const data = JSON.stringify(JSON.parse(read('data/yolodwarf_data.json'))).replace(/</g, '\\u003c');
const body = read('index.html').match(/<body>([\s\S]*?)<noscript>/)[1].trim();
const js = ['js/engine.js', 'js/rng.js', 'js/game.js', 'js/ui.js'].map(f => `// ── ${f}\n${strip(read(f))}`).join('\n');

const html = `<title>욜로드워프 데모</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${read('css/style.css')}
html, body { height: 100%; }
main { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
</style>
${body}
<script type="module">
globalThis.__YOLO_DATA__ = ${data};
${js}
</script>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/yolodwarf-single.html'), html);
console.log(`dist/yolodwarf-single.html (${(html.length / 1024).toFixed(0)}KB)`);
