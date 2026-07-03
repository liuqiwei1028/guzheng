App({
  globalData: {
    token: "",
    user: null,
  },
  onLaunch() {
    this.globalData.token = wx.getStorageSync("mp_token") || "";
    this.globalData.user = wx.getStorageSync("mp_user") || null;
  },
});
