import { Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors, Body, Res } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MaterialService } from "./material.service";

@Controller("materials")
export class MaterialController {
  constructor(private readonly svc: MaterialService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file"))
  upload(@UploadedFile() file: any, @Body("campaignId") campaignId?: string) {
    return this.svc.upload(file, campaignId);
  }

  // 测试/预览局域网文件夹（可选账号密码，密码不入库）
  @Post("folder/test")
  testFolder(@Body() body: { dir?: string; user?: string; pass?: string }) {
    return this.svc.previewFolder(body.dir, body.user, body.pass);
  }

  // 局域网文件夹某张图的缩略图
  @Get("folder/file")
  folderFile(
    @Query("dir") dir: string,
    @Query("name") name: string,
    @Query("w") w: string,
    @Res() res: any,
  ) {
    return this.svc.streamFolderFile(dir, name, Number(w) || 320, res);
  }

  @Get()
  list(@Query("campaignId") campaignId?: string) {
    return this.svc.list(campaignId);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.remove(id);
  }
}
