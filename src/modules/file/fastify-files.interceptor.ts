import {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  Type,
  mixin,
  BadRequestException,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { Readable } from "stream";
import { MulterFile } from "./multer-file.interface";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export function FastifyFilesInterceptor(fieldName: string): Type<NestInterceptor> {
  class MixinInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
      const ctx = context.switchToHttp();
      const req = ctx.getRequest();

      if (!req.isMultipart || !req.isMultipart()) {
        throw new BadRequestException("Request is not multipart");
      }

      try {
        const parts = req.parts();
        const files: MulterFile[] = [];

        for await (const part of parts) {
          if (part.type === "file") {
            if (part.fieldname === fieldName) {
              const buffer = await streamToBuffer(part.file);
              files.push({
                fieldname: part.fieldname,
                originalname: part.filename,
                encoding: part.encoding,
                mimetype: part.mimetype,
                size: buffer.length,
                buffer: buffer,
              });
            } else {
              part.file.resume();
            }
          }
        }

        req.files = files;
      } catch (err) {
        throw new BadRequestException(err.message || "Files upload failed");
      }

      return next.handle();
    }
  }

  return mixin(MixinInterceptor);
}
