import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from "@nestjs/common";
import { FastifyFileInterceptor } from "./fastify-file.interceptor";
import { FastifyFilesInterceptor } from "./fastify-files.interceptor";
import * as express from "express";
import { FileService } from "./file.service";
import { ApiTags, ApiConsumes, ApiBody } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { UploadFileListResponse, UploadFileResponse } from "./upload-file.response";

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("File Management")
@Controller("files")
@UseGuards(JwtAuthGuard)
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post("upload")
  @UseInterceptors(FastifyFileInterceptor("files"))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  async uploadFile(@UploadedFile() file: MulterFile): Promise<UploadFileResponse> {
    return this.fileService.uploadSingleFile(file);
  }

  @Post("upload-multiple")
  @UseInterceptors(FastifyFilesInterceptor("files"))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
        },
      },
    },
  })
  async uploadFiles(@UploadedFiles() files: MulterFile[]): Promise<UploadFileListResponse> {
    return this.fileService.uploadMultipleFiles(files);
  }

  @Get(":fileName")
  async getFile(@Param("fileName") fileName: string, @Res() res: express.Response) {
    const { stream, meta } = await this.fileService.getFileStream(fileName);
    res.setHeader("Content-Type", meta.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(meta.fileName)}"`);
    stream.pipe(res);
  }

  @Get("file/:key")
  async getFileInfo(@Param("key") key: string) {
    return await this.fileService.getFileInfo(key);
  }

  @Delete()
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        fileNames: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  })
  async deleteFiles(@Body("fileNames") fileNames: string[]) {
    return this.fileService.deleteFiles(fileNames);
  }
}
