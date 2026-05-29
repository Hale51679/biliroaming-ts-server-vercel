import type { NextApiRequest, NextApiResponse } from "next";
import * as env from "../../../../../../src/_config";

const api = env.api.main.web.user_info;

function patchNavResponse(body: any): any {
  if (!body || body.code !== 0 || !body.data) return body;

  if (env.unlock_quality_enabled && body.data) {
    // 伪造大会员信息
    if (body.data.vip) {
      body.data.vip.vipType = 2;
      body.data.vip.vipStatus = 1;
      body.data.vip.vipDueDate = 9999999999000;
      body.data.vip.vip_pay_type = 1;
      body.data.vip.themeType = 0;
      body.data.vip.label.vip_plus = 1;
    }
    // 伪造钱包信息（部分版本检查）
    if (body.data.wallet) {
      body.data.wallet.mid = body.data.mid || 0;
    }
    // 确保会员过期时间很远
    if (body.data.vip_pay_type === undefined) {
      body.data.vip_pay_type = 1;
    }
  }

  return body;
}

const main = async (req: NextApiRequest, res: NextApiResponse) => {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (new RegExp("^https?://([a-z]+.bilibili.com|bilibili.com)$", "g").test(
    req.headers.origin || ''
  )) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin as string);
  }

  fetch(api + req.url, {
    method: req.method,
    headers: {
      "User-Agent": env.UA,
      "Cookie": req.headers.cookie || "",
    },
  })
    .then((response) => response.json())
    .then((response) => {
      const log = env.logger.child({
        action: "用户信息(网页端)",
        method: req.method,
        url: req.url,
      });
      log.info({});
      log.debug({ context: response });
      res.json(patchNavResponse(response));
    });
};

export default main;
