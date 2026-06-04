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

export function FastifyFileInterceptor(fieldName: string): Type<NestInterceptor> {
  class MixinInterceptor implements NestInterceptor {
    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
      const ctx = context.switchToHttp();
      const req = ctx.getRequest();

      if (!req.isMultipart || !req.isMultipart()) {
        throw new BadRequestException("Request is not multipart");
      }

      try {
        const file = await req.file();
        if (file && file.fieldname === fieldName) {
          const buffer = await streamToBuffer(file.file);
          req.file = {
            fieldname: file.fieldname,
            originalname: file.filename,
            encoding: file.encoding,
            mimetype: file.mimetype,
            size: buffer.length,
            buffer: buffer,
          };
        }
      } catch (err) {
        throw new BadRequestException(err.message || "File upload failed");
      }

      return next.handle();
    }
  }

  return mixin(MixinInterceptor);
}
