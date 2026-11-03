// JSON where numbers keep their exact text. ETA signs the text of each value as written ("0.0" must stay "0.0", "10.50" must
// stay "10.50"), so the text we sign has to be byte-identical to the text we send. JavaScript numbers cannot guarantee that,
// so documents here use RawNumber for every numeric value, and we write and read JSON ourselves.

export class RawNumber {
  readonly text: string;
  constructor(text: string) {
    if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) throw new Error(`INVALID_NUMBER_TEXT: "${text}"`);
    this.text = text;
  }
}

/** Ordered document values. Objects keep insertion order, which is the order that is signed and sent. */
export type DocValue = string | RawNumber | boolean | null | DocValue[] | { [key: string]: DocValue };
export type DocObject = { [key: string]: DocValue };

export const num = (text: string): RawNumber => new RawNumber(text);

/** Compact JSON with numbers written exactly as their stored text. */
export function stringifyDoc(v: DocValue): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof RawNumber) return v.text;
  if (Array.isArray(v)) return `[${v.map(stringifyDoc).join(',')}]`;
  return `{${Object.entries(v)
    .map(([k, x]) => `${JSON.stringify(k)}:${stringifyDoc(x)}`)
    .join(',')}}`;
}

/** Parse JSON keeping property order and number text. Small and strict; used for test vectors and stored payloads. */
export function parseDoc(src: string): DocValue {
  let i = 0;
  const ws = () => {
    while (i < src.length && ' \t\r\n'.includes(src[i] as string)) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(`JSON_PARSE: ${msg} at ${i}`);
  };
  const str = (): string => {
    const start = i;
    i++;
    while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    if (i >= src.length) fail('unterminated string');
    i++;
    return JSON.parse(src.slice(start, i)) as string;
  };
  const value = (): DocValue => {
    ws();
    const c = src[i];
    if (c === '{') {
      i++;
      const o: DocObject = {};
      ws();
      if (src[i] === '}') {
        i++;
        return o;
      }
      for (;;) {
        ws();
        if (src[i] !== '"') fail('expected property name');
        const k = str();
        ws();
        if (src[i] !== ':') fail('expected ":"');
        i++;
        o[k] = value();
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return o;
        }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const a: DocValue[] = [];
      ws();
      if (src[i] === ']') {
        i++;
        return a;
      }
      for (;;) {
        a.push(value());
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return a;
        }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return str();
    if (src.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (src.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (src.startsWith('null', i)) {
      i += 4;
      return null;
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) return fail('unexpected character');
    i += m[0].length;
    return new RawNumber(m[0]);
  };
  const out = value();
  ws();
  if (i !== src.length) fail('trailing characters');
  return out;
}
