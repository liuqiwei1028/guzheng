const config = require("../../config");
const { request, clearSession } = require("../../utils/request");

Page({
  data: {
    src: "",
  },

  async onLoad() {
    const token = wx.getStorageSync("mp_token");
    if (!token) {
      this.redirectToLogin();
      return;
    }

    try {
      await request("/api/miniprogram/me");
      this.setData({ src: withMiniProgramFlag(config.webviewUrl) });
    } catch {
      clearSession();
      this.redirectToLogin();
    }
  },

  redirectToLogin() {
    wx.reLaunch({ url: "/pages/login/login" });
  },
});

function withMiniProgramFlag(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}mp=1`;
}
