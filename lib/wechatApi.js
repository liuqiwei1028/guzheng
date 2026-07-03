const WECHAT_API_BASE = "https://api.weixin.qq.com";

let cachedAccessToken = null;

function getWechatConfig() {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_APPSECRET;
  if (!appid || !secret) {
    throw new Error("WECHAT_APPID or WECHAT_APPSECRET is not configured");
  }
  return { appid, secret };
}

function assertWechatOk(data, fallbackMessage) {
  if (data?.errcode) {
    throw new Error(`${fallbackMessage}: ${data.errcode} ${data.errmsg || ""}`.trim());
  }
}

export async function code2Session(jsCode) {
  const { appid, secret } = getWechatConfig();
  const url = new URL(`${WECHAT_API_BASE}/sns/jscode2session`);
  url.searchParams.set("appid", appid);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", jsCode);
  url.searchParams.set("grant_type", "authorization_code");

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await response.json();
  assertWechatOk(data, "微信登录失败");
  if (!data.openid) throw new Error("微信登录失败: missing openid");
  return data;
}

export async function getWechatAccessToken() {
  const now = Date.now();
  if (cachedAccessToken?.token && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.token;
  }

  const { appid, secret } = getWechatConfig();
  const url = new URL(`${WECHAT_API_BASE}/cgi-bin/token`);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appid);
  url.searchParams.set("secret", secret);

  const response = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await response.json();
  assertWechatOk(data, "获取微信 access_token 失败");
  if (!data.access_token) throw new Error("获取微信 access_token 失败: missing access_token");

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + Math.max(Number(data.expires_in || 7200) - 120, 60) * 1000,
  };
  return cachedAccessToken.token;
}

export async function getPhoneNumber(phoneCode) {
  const accessToken = await getWechatAccessToken();
  const url = `${WECHAT_API_BASE}/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: phoneCode }),
    cache: "no-store",
  });
  const data = await response.json();
  assertWechatOk(data, "获取微信手机号失败");
  if (!data.phone_info?.purePhoneNumber && !data.phone_info?.phoneNumber) {
    throw new Error("获取微信手机号失败: missing phone_info");
  }
  return data.phone_info;
}
