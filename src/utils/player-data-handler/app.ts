import qs from "qs";
import * as env from "../../_config";
import * as blacklist from "../_blacklist";
import * as bili from "../_bili";
import * as playerUtil from "../_player";
import { IncomingHttpHeaders } from "http";

const qualityConfig: Record<number, { name: string }> = {
  127: { name: '8K 超高清' },
  120: { name: '4K 超高清' },
  116: { name: '1080P 60帧' },
  112: { name: '1080P 高码率' },
  80:  { name: '1080P' },
  74:  { name: '720P 60帧' },
  64:  { name: '720P' },
  32:  { name: '480P' },
  16:  { name: '360P' },
};

function injectQualityParams(urlStr: string): string {
  const [basePath, queryStr] = urlStr.split('?');
  if (!queryStr) return urlStr;
  const params = new URLSearchParams(queryStr);
  params.set('fnval', '4048');
  params.set('fourk', '1');
  return basePath + '?' + params.toString();
}

function patchPlayUrlResponse(response: any): any {
  if (!response || response.code !== 0 || !response.data) return response;
  const data = response.data;

  if (env.unlock_quality_enabled) {
    if (data.vip_type === undefined || data.vip_type === 0) {
      data.vip_type = 2;
    }
    if (data.vip_status === undefined || data.vip_status === 0) {
      data.vip_status = 1;
    }
  }

  const dashVideo = data?.dash?.video;
  if (!Array.isArray(dashVideo)) return response;

  let acceptQuality: number[] = Array.isArray(data.accept_quality) ? [...data.accept_quality] : [];
  let acceptDescription: string[] = Array.isArray(data.accept_description) ? [...data.accept_description] : [];

  let changed = false;
  for (const video of dashVideo) {
    const qId = video.id;
    if (typeof qId === 'number' && !acceptQuality.includes(qId) && qualityConfig[qId]) {
      acceptQuality.push(qId);
      acceptDescription.push(qualityConfig[qId].name);
      changed = true;
    }
  }

  if (changed) {
    const zipped: { q: number; desc: string }[] = [];
    for (let i = 0; i < acceptQuality.length; i++) {
      zipped.push({ q: acceptQuality[i], desc: acceptDescription[i] || '' });
    }
    zipped.sort((a, b) => b.q - a.q);
    data.accept_quality = zipped.map(x => x.q);
    data.accept_description = zipped.map(x => x.desc);
  }

  return response;
}

const fetchDataFromBiliAndCache = async (url_data: string) => {
  const enhancedUrl = env.unlock_quality_enabled ? injectQualityParams(url_data) : url_data;
  const res = (await fetch(
    env.api.main.app.playurl + enhancedUrl,
    env.fetch_config_UA
  ).then((res) => res.json())) as any;
  if (res.code === 0) {
    await playerUtil.addNewCache(url_data, res);
    if (env.unlock_quality_enabled) patchPlayUrlResponse(res);
  }
  return env.try_unblock_CDN_speed_enabled
    ? JSON.parse(JSON.stringify(res).replace(/bw=[^&]*/g, "bw=1280000"))
    : res;
};

export const middleware = async (
  url_data: string,
  headers: IncomingHttpHeaders,
  method: string
): Promise<[boolean, number, any?]> => {
  const log = env.logger.child({
    action: "获取playurl(APP端)",
    method: method || "unknown",
    url: url_data,
  });

  if (!headers["x-from-biliroaming"] && env.web_on === 0) return [false, 1];
  if (env.ver_min !== 0 && env.ver_min > Number(headers["build"]))
    return [false, 2];

  const url = new URL(url_data, env.api.main.app.playurl);
  if (!url.search || !url.search) return [false, 7];
  const data = qs.parse(url.search.slice(1));
  if (data.ep_id && env.block_bangumi.ep.includes(Number(data.ep_id)))
    return [false, 8, "ep_id" + data.ep_id];
  if (data.cid && env.block_bangumi.cid.includes(Number(data.cid)))
    return [false, 8, "cid" + data.cid];
  if (data.avid && env.block_bangumi.avid.includes(Number(data.avid)))
    return [false, 8, "avid" + data.avid];
  if (data.bvid && env.block_bangumi.bvid.includes(data.bvid as string))
    return [false, 8, "bvid" + data.bvid];

  const info = await bili.access_keyParams2info(url.search);
  if (info.uid === 0) {
    if (!env.need_login) return [true, 0, JSON.stringify(info)];
    else return [false, 6];
  }
  if (!data.access_key) return [false, 7];
  if (env.need_login && !data.access_key) return [false, 6];
  const log_data = {
    access_key: data.access_key as string,
    UID: info.uid,
    vip_type: info.vip_type,
    url: url_data,
  };
  log.info({});
  log.debug({ headers, user_info: log_data });
  await playerUtil.addNewLog_bitio(log_data);
  await playerUtil.addNewLog_notion(log_data);

  const blacklist_data = await blacklist.main(info.uid);
  if (blacklist_data.code != 0) return [false, 3];
  else {
    if (env.whitelist_enabled) {
      if (blacklist_data.data.is_whitelist)
        return [true, 0, JSON.stringify(info)];
      else return [false, 5];
    }
    if (env.blacklist_enabled && blacklist_data.data.is_blacklist)
      return [false, 4];
    return [true, 0, JSON.stringify(info)];
  }
};

export const main = async (
  url_data: string,
  info_cahce?: {
    uid: number;
    vip_type: 0 | 1 | 2;
  }
) => {
  const url = new URL(url_data, env.api.main.app.playurl);
  const data = qs.parse(url.search.slice(1));
  const info = info_cahce || (await bili.access_keyParams2info(url.search));
  if (env.need_login && info.uid === 0) return env.block(6);
  const rCache = await playerUtil.readCache(
    Number(data.cid),
    Number(data.ep_id),
    info
  );
  if (rCache) return rCache;
  else return fetchDataFromBiliAndCache(url_data);
};
