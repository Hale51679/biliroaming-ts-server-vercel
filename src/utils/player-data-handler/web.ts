import qs from "qs";
import * as env from "../../_config";
import * as blacklist from "../_blacklist";
import * as bili from "../_bili";
import * as playerUtil from "../_player";

const checkBlackList = async (uid: number): Promise<[boolean, number]> => {
  const blacklist_data = await blacklist.main(uid);
  if (blacklist_data.code != 0) return [false, 3];
  else {
    if (env.whitelist_enabled) {
      if (blacklist_data.data.is_whitelist) return [true, 0];
      else return [false, 5];
    }
    if (env.blacklist_enabled && blacklist_data.data.is_blacklist)
      return [false, 4];
    return [true, 0];
  }
};

export const middleware = async (
  url_data: string,
  cookies: any,
  PassWebOnCheck: 0 | 1,
  method?: string
): Promise<[boolean, number, any?]> => {
  const log = env.logger.child({
    action: "获取playurl(网页端)",
    method: method || "unknown",
    url: url_data,
  });

  if (!env.web_on && PassWebOnCheck === 0) return [false, 1];

  const url = new URL(url_data, env.api.main.web.playurl);
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

  if (!env.need_login) return [true, 0, { uid: 0, vip_type: 0 }];

  if (env.need_login && !data.access_key && !cookies.access_key) {
    return [false, 6];
  }

  let access_key: string;
  if (!data.access_key && cookies.access_key) {
    access_key = cookies.access_key;
  }
  const info = await bili.access_key2info(
    (data.access_key as string) || access_key
  );
  if (!info) return [false, 6];
  const log_data = {
    access_key: (data.access_key as string) || access_key,
    UID: info.uid,
    vip_type: info.vip_type,
    url: url_data,
  };
  log.info({});
  log.debug({ cookies, user_info: log_data });
  await playerUtil.addNewLog_bitio(log_data);
  await playerUtil.addNewLog_notion(log_data);

  const checked_res = await checkBlackList(info.uid);
  return [...checked_res, JSON.stringify(info)];
};

const qualityNames: Record<number, string> = {
  127: '8K 超高清',
  120: '4K 超高清',
  116: '1080P 60帧',
  112: '1080P 高码率',
  80:  '1080P',
  74:  '720P 60帧',
  64:  '720P',
  32:  '480P',
  16:  '360P',
};

function injectQualityParams(urlStr: string): string {
  const [basePath, queryStr] = urlStr.split('?');
  if (!queryStr) return urlStr;
  const params = new URLSearchParams(queryStr);
  params.set('fnval', '4048');
  params.set('fourk', '1');
  return basePath + '?' + params.toString();
}

function addMissingQuality(response: any): any {
  if (!response || response.code !== 0 || !response.data) return response;
  const data = response.data;
  const dashVideo = data?.dash?.video;
  if (!Array.isArray(dashVideo)) return response;

  let acceptQuality: number[] = Array.isArray(data.accept_quality) ? [...data.accept_quality] : [];
  let acceptDescription: string[] = Array.isArray(data.accept_description) ? [...data.accept_description] : [];

  let changed = false;
  for (const video of dashVideo) {
    const qId = video.id;
    if (typeof qId === 'number' && !acceptQuality.includes(qId) && qualityNames[qId]) {
      acceptQuality.push(qId);
      acceptDescription.push(qualityNames[qId]);
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

export const main = async (
  url_data: string,
  cookies,
  info_cache?: {
    uid: number;
    vip_type: 0 | 1 | 2;
  }
) => {
  const url = new URL(url_data, env.api.main.web.playurl);
  const data = qs.parse(url.search.slice(1));
  const login = data.access_key || !playerUtil.isEmptyObject(cookies);
  if (login) {
    let info = info_cache || null,
      access_key: string;
    if (!data.access_key && cookies) access_key = cookies.access_key;
    if (!info)
      info = await bili.access_key2info(
        (data.access_key as string) || access_key
      );
    const rCache = await playerUtil.readCache(
      Number(data.cid),
      Number(data.ep_id),
      info
    );
    if (rCache) return { code: 0, message: "success", result: rCache };
    else {
      const enhancedUrl = env.unlock_quality_enabled ? injectQualityParams(url_data) : url_data;
      const fetchUrl = env.api.main.web.playurl + enhancedUrl + (access_key ? "&access_key=" + access_key : "");
      const res = (await fetch(fetchUrl, env.fetch_config_UA).then((res) => res.json())) as any;
      if (res.code === 0) {
        await playerUtil.addNewCache(url_data, res?.result);
        if (env.unlock_quality_enabled) addMissingQuality(res);
      }
      return env.try_unblock_CDN_speed_enabled
        ? JSON.parse(JSON.stringify(res).replace(/bw=[^&]*/g, "bw=1280000"))
        : res;
    }
  } else {
    cookies = bili.getCookies();
    const enhancedUrl = env.unlock_quality_enabled ? injectQualityParams(url_data) : url_data;
    const res = (await fetch(env.api.main.web.playurl + enhancedUrl, {
      headers: { "User-Agent": env.UA, cookie: cookies },
    }).then((res) => res.json())) as any;
    if (res.code === 0) {
      await playerUtil.addNewCache(url_data, res?.result);
      if (env.unlock_quality_enabled) addMissingQuality(res);
    }
    return env.try_unblock_CDN_speed_enabled
      ? JSON.parse(JSON.stringify(res).replace(/bw=[^&]*/g, "bw=1280000"))
      : res;
  }
};
