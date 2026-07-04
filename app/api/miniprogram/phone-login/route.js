import { NextResponse } from "next/server";
import { createMiniProgramToken, hashPhone, maskPhone, toMiniProgramUser } from "@/lib/miniprogramAuth";
import { getPhoneNumber } from "@/lib/wechatApi";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { code } = await request.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "缺少本机手机号授权 code" }, { status: 400 });
    }

    const phoneInfo = await getPhoneNumber(code);
    const phoneNumber = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber;
    const phoneMasked = maskPhone(phoneNumber);
    const { token, expiresIn, expiresAt } = createMiniProgramToken({
      loginType: "phone",
      phoneHash: hashPhone(phoneNumber),
      phoneMasked,
      countryCode: phoneInfo.countryCode || "86",
    });

    return NextResponse.json({
      token,
      expiresIn,
      user: toMiniProgramUser({
        loginType: "phone",
        phoneHash: true,
        phoneMasked,
        exp: expiresAt,
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "本机手机号一键登录失败" }, { status: 500 });
  }
}
