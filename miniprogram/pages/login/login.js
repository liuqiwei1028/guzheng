const { request, saveSession } = require("../../utils/request");

Page({
  data: {
    loadingWechat: false,
    loadingPhone: false,
    message: "",
  },

  onLoad() {
    this.checkExistingSession();
  },

  async checkExistingSession() {
    const token = wx.getStorageSync("mp_token");
    if (!token) return;
    try {
      await request("/api/miniprogram/me");
      this.enterApp();
    } catch {
      wx.removeStorageSync("mp_token");
      wx.removeStorageSync("mp_user");
    }
  },

  loginWithWechat() {
    this.setData({ loadingWechat: true, message: "" });
    wx.login({
      success: async (loginResult) => {
        try {
          if (!loginResult.code) throw new Error("未获取到微信登录 code");
          const data = await request("/api/miniprogram/login", {
            method: "POST",
            data: { code: loginResult.code },
          });
          saveSession(data);
          this.enterApp();
        } catch (error) {
          this.setData({ message: error.message || "微信登录失败" });
        } finally {
          this.setData({ loadingWechat: false });
        }
      },
      fail: () => {
        this.setData({ loadingWechat: false, message: "微信登录调用失败，请稍后重试" });
      },
    });
  },

  async loginWithPhone(event) {
    const detail = event.detail || {};
    if (!detail.code) {
      this.setData({ message: detail.errMsg || "未完成手机号授权" });
      return;
    }

    this.setData({ loadingPhone: true, message: "" });
    try {
      const data = await request("/api/miniprogram/phone-login", {
        method: "POST",
        data: { code: detail.code },
      });
      saveSession(data);
      this.enterApp();
    } catch (error) {
      this.setData({ message: error.message || "手机号登录失败" });
    } finally {
      this.setData({ loadingPhone: false });
    }
  },

  enterApp() {
    wx.reLaunch({ url: "/pages/webview/webview" });
  },
});
