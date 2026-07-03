const config = require("../config");

function request(path, options = {}) {
  const token = wx.getStorageSync("mp_token") || "";
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.apiBaseUrl}${path}`,
      method: options.method || "GET",
      data: options.data || {},
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.header || {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data?.error || `请求失败：${res.statusCode}`));
        }
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      },
    });
  });
}

function saveSession(data) {
  wx.setStorageSync("mp_token", data.token);
  wx.setStorageSync("mp_user", data.user);
  const app = getApp();
  app.globalData.token = data.token;
  app.globalData.user = data.user;
}

function clearSession() {
  wx.removeStorageSync("mp_token");
  wx.removeStorageSync("mp_user");
  const app = getApp();
  app.globalData.token = "";
  app.globalData.user = null;
}

module.exports = {
  request,
  saveSession,
  clearSession,
};
