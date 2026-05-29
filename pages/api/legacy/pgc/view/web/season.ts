import type { NextApiRequest, NextApiResponse } from "next";
import * as env from "../../../../../../src/_config";

const api = env.api.main.web.season_info;

/**
 * 在 season 响应中伪造大会员权限
 */
function patchSeasonResponse(body: any): any {
  if (!body || body.code !== 0 || !body.result) return body;
  const result = body.result;

  // 修改用户状态
  if (result.user_status) {
    if (env.unlock_quality_enabled) {
      result.user_status.vip_type = 2;
      result.user_status.vip_status = 1;
    }
  }

  // 修改播放权限
  if (result.rights) {
    if (env.unlock_quality_enabled) {
      result.rights.can_watch = 1;
      result.rights.can_download = 1;
      result.rights.only_vip_download = 0;
    }
  }

  return body;
}

const main = async (req: NextApiRequest, res: NextApiResponse) => {
  fetch(api + req.url, {
    method: req.method,
    headers: {
      "User-Agent": env.UA,
    },
  })
    .then((response) => response.json())
    .then((response) => {
      const log = env.logger.child({
        action: "番剧详情(网页端)",
        method: req.method,
        url: req.url,
      });
      log.info({});
      log.debug({ context: response });
      res.json(patchSeasonResponse(response));
    });
};

export default main;
