// 시드로 다시 만들 수 있는 무작위. 같은 시드 글자 → 같은 수열.
function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function makeRng(seedText) {
  let a = hash(String(seedText));
  const rand = () => {                    // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    rand,
    int: n => Math.floor(rand() * n),
    shuffle(list) {
      const a2 = list.slice();
      for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; }
      return a2;
    },
    weighted(items, weightOf) {
      const total = items.reduce((s, x) => s + weightOf(x), 0);
      let r = rand() * total;
      for (const x of items) { r -= weightOf(x); if (r < 0) return x; }
      return items[items.length - 1];
    },
  };
}

export const randomSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase();
