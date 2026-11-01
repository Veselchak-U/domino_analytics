/** JSON.parse checks grammar; this separate lexical pass rejects duplicate decoded keys. */
export function strictJson(text) {
  // Reject excessive nesting before JSON.parse allocates an arbitrarily deep value.
  let nesting=0,inString=false,escaped=false;
  for(const c of text){
    if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}
    else if(c==='"')inString=true;
    else if(c==='{'||c==='['){if(++nesting>65)throw new Error('JSON слишком глубоко вложен (максимум 64)');}
    else if(c==='}'||c===']')nesting--;
  }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Неверный JSON: ${e.message}`); }
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
  }
  function visit(depth) {
    if (depth > 64) throw new Error('JSON слишком глубоко вложен (максимум 64)');
    space();
    if (text[i] === '{') {
      i++; space();
      const keys = new Set();
      while (text[i] !== '}') {
        const key = string();
        if (keys.has(key)) throw new Error(`Повтор ключа JSON «${key}» возле позиции ${i}`);
        keys.add(key); space(); i++; visit(depth + 1); space();
        if (text[i] === ',') { i++; space(); } else break;
      }
      i++;
    } else if (text[i] === '[') {
      i++; space();
      while (text[i] !== ']') {
        visit(depth + 1); space();
        if (text[i] === ',') { i++; space(); } else break;
      }
      i++;
    } else if (text[i] === '"') string();
    else {
      const start = i;
      while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
      const token = text.slice(start, i);
      if (!['null', 'true', 'false'].includes(token) && (!Number.isFinite(Number(token)) || (Number.isInteger(Number(token)) && !Number.isSafeInteger(Number(token)))))
        throw new Error(`Число вне точного целочисленного диапазона: ${token}`);
    }
  }
  visit(0);
  return data;
}
