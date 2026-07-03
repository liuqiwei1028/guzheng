import crypto from "crypto";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function getSessionSecret() {
  const secret = process.env.MINIPROGRAM_SESSION_SECRET || process.env.WECHAT_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("MINIPROGRAM_SESSION_SECRET is not configured");
  }
  return secret || "dev-miniprogram-session-secret";
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function sign(value) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function hashPhone(phoneNumber) {
  return crypto.createHash("sha256").update(`${getSessionSecret()}:${phoneNumber}`).digest("hex");
}

export function maskPhone(phoneNumber = "") {
  const value = String(phoneNumber);
  if (value.length < 7) return value ? "***" : "";
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

export function createMiniProgramToken(payload, ttlSeconds = SESSION_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encodedHeader = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const encodedBody = base64UrlJson(body);
  const signature = sign(`${encodedHeader}.${encodedBody}`);
  return {
    token: `${encodedHeader}.${encodedBody}.${signature}`,
    expiresIn: ttlSeconds,
    expiresAt: body.exp,
  };
}

export function verifyMiniProgramToken(token) {
  if (!token || typeof token !== "string") throw new Error("Missing token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [encodedHeader, encodedBody, signature] = parts;
  const expected = sign(`${encodedHeader}.${encodedBody}`);
  const actual = Buffer.from(signature);
  const target = Buffer.from(expected);
  if (actual.length !== target.length || !crypto.timingSafeEqual(actual, target)) {
    throw new Error("Invalid signature");
  }
  const payload = JSON.parse(Buffer.from(encodedBody, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}

export function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export function toMiniProgramUser(session) {
  return {
    loginType: session.loginType,
    hasPhone: Boolean(session.phoneHash),
    phoneMasked: session.phoneMasked || "",
    expiresAt: session.exp,
  };
}
