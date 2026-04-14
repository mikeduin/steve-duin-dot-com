import db from "../db/knex.js";
import { parseCurlRequest } from "./curl.js";

export const NEWSBANK_CONFIG_KEY = "newsbank";

type NewsbankRequestConfigRow = {
  id: number;
  key: string;
  curl_text: string;
  request_url: string | null;
  method: string;
  cookie_header: string | null;
  headers_json: unknown;
  body_text: string | null;
};

export type NewsbankRequestConfig = {
  id: number;
  key: string;
  curlText: string;
  requestUrl: string | null;
  method: string;
  cookieHeader: string | null;
  headers: Record<string, string>;
  bodyText: string | null;
};

const normalizeHeaders = (headersJson: unknown) => {
  if (!headersJson || typeof headersJson !== "object") {
    return {};
  }

  return Object.entries(headersJson as Record<string, unknown>).reduce<Record<string, string>>(
    (accumulator, [key, value]) => {
      if (typeof value === "string") {
        accumulator[key] = value;
      }
      return accumulator;
    },
    {}
  );
};

export const loadNewsbankRequestConfig = async () => {
  const row = await db("newsbank_request_configs")
    .where({ key: NEWSBANK_CONFIG_KEY })
    .first<NewsbankRequestConfigRow>();

  if (!row) {
    return null;
  }

  const parsed = parseCurlRequest(row.curl_text);

  const config: NewsbankRequestConfig = {
    id: row.id,
    key: row.key,
    curlText: row.curl_text,
    requestUrl: row.request_url,
    method: row.method,
    cookieHeader: row.cookie_header ?? parsed.cookieHeader,
    headers: {
      ...normalizeHeaders(row.headers_json),
      ...(parsed.cookieHeader ? { Cookie: parsed.cookieHeader } : {})
    },
    bodyText: row.body_text
  };

  return config;
};
