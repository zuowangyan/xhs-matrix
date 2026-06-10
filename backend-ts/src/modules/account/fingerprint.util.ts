// 为每个账号生成一套稳定且互不相同的浏览器指纹（直连方案下尤其重要：
// 让同一 IP 下的多个号看起来像"同一网络的不同设备"）。
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1680, height: 1050 },
];
const LANGS = ["zh-CN", "zh-CN,zh", "zh-CN,zh;q=0.9"];
const TIMEZONES = ["Asia/Shanghai"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFingerprint() {
  const vp = pick(VIEWPORTS);
  return {
    ua: pick(UAS),
    viewport: JSON.stringify(vp),
    timezone: pick(TIMEZONES),
    language: pick(LANGS),
    // 给 canvas/webgl 一个稳定的随机噪声种子，运行时据此微扰指纹
    webgl: JSON.stringify({ noise: Math.random().toString(36).slice(2, 10) }),
    canvas: JSON.stringify({ noise: Math.random().toString(36).slice(2, 10) }),
  };
}
