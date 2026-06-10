import * as path from "path";
import * as fs from "fs";

/**
 * 统一数据目录：开发时用 backend-ts/data；打包后由 Electron 通过 DATA_DIR 指向用户可写目录
 * （安装目录是只读的，DB/cookie/图片必须写到 userData）。
 */
export function dataDir(): string {
  const dir = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dataSub(...parts: string[]): string {
  const dir = path.join(dataDir(), ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
