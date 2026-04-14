type ParsedCurlRequest = {
  rawCurl: string;
  requestUrl: string | null;
  method: string;
  headers: Record<string, string>;
  cookieHeader: string | null;
  body: string | null;
};

const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode"]);
const COOKIE_FLAGS = new Set(["-b", "--cookie"]);

const stripWrappedQuotes = (value: string) => {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
};

const tokenizeCommand = (input: string) => {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
};

const parseHeader = (headerLine: string) => {
  const separatorIndex = headerLine.indexOf(":");
  if (separatorIndex < 1) return null;

  const key = headerLine.slice(0, separatorIndex).trim();
  const value = headerLine.slice(separatorIndex + 1).trim();
  if (!key) return null;

  return { key, value };
};

export const parseCurlRequest = (rawCurl: string): ParsedCurlRequest => {
  const normalized = rawCurl.replace(/\\\r?\n/g, " ").trim();
  const tokens = tokenizeCommand(normalized);

  const headers: Record<string, string> = {};
  let requestUrl: string | null = null;
  let method = "GET";
  let body: string | null = null;
  let cookieFromFlag: string | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (index === 0 && token === "curl") {
      continue;
    }

    if ((token === "-X" || token === "--request") && tokens[index + 1]) {
      method = tokens[index + 1].toUpperCase();
      index += 1;
      continue;
    }

    if (token.startsWith("--request=")) {
      method = token.slice("--request=".length).toUpperCase();
      continue;
    }

    if ((token === "-H" || token === "--header") && tokens[index + 1]) {
      const parsed = parseHeader(tokens[index + 1]);
      if (parsed) {
        headers[parsed.key] = parsed.value;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--header=")) {
      const parsed = parseHeader(token.slice("--header=".length));
      if (parsed) {
        headers[parsed.key] = parsed.value;
      }
      continue;
    }

    if (DATA_FLAGS.has(token) && tokens[index + 1]) {
      body = stripWrappedQuotes(tokens[index + 1]);
      if (method === "GET") {
        method = "POST";
      }
      index += 1;
      continue;
    }

    if (COOKIE_FLAGS.has(token) && tokens[index + 1]) {
      cookieFromFlag = stripWrappedQuotes(tokens[index + 1]);
      headers.Cookie = cookieFromFlag;
      index += 1;
      continue;
    }

    if (token.startsWith("--cookie=")) {
      cookieFromFlag = stripWrappedQuotes(token.slice("--cookie=".length));
      headers.Cookie = cookieFromFlag;
      continue;
    }

    if (!requestUrl && !token.startsWith("-")) {
      requestUrl = stripWrappedQuotes(token);
    }
  }

  const cookieEntry = Object.entries(headers).find(([key]) => key.toLowerCase() === "cookie");

  return {
    rawCurl: rawCurl.trim(),
    requestUrl,
    method,
    headers,
    cookieHeader: cookieFromFlag ?? (cookieEntry ? cookieEntry[1] : null),
    body
  };
};
