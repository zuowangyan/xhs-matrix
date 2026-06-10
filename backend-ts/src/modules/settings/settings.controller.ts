import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { SettingsService } from "./settings.service";

@Controller("settings")
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  // 局域网共享信息（是否开启 + 可分享地址）
  @Get("system/lan")
  getLan() {
    return this.service.getLanInfo();
  }

  // 开机自启：读取/设置（放在 :group 之前，避免被通配匹配）
  @Get("system/autolaunch")
  getAutoLaunch() {
    return this.service.getAutoLaunch();
  }

  @Put("system/autolaunch")
  setAutoLaunch(@Body() body: { enabled: boolean }) {
    return this.service.setAutoLaunch(!!body.enabled);
  }

  @Get(":group")
  async get(@Param("group") group: string) {
    const data = await this.service.getGroup(group);
    // 脱敏：apiKey 只回是否已设置 + 末4位
    if (data.apiKey) {
      const k = String(data.apiKey);
      data.apiKeySet = true;
      data.apiKeyMask = k.length > 4 ? "****" + k.slice(-4) : "****";
      delete data.apiKey;
    }
    return data;
  }

  @Put(":group")
  async put(@Param("group") group: string, @Body() body: Record<string, any>) {
    // 若前端传空 apiKey（未修改），不要覆盖已存的
    if (body.apiKey === "" || body.apiKey === undefined) delete body.apiKey;
    await this.service.setGroup(group, body);
    return this.get(group);
  }
}
