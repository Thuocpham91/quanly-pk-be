import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { useContainer } from 'class-validator';
import { useSwagger } from './configs';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const morgan = require('morgan');

process.on('unhandledRejection', (reason) => {
  console.error('🔥 UNHANDLED PROMISE REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

async function bootstrap() {
  try {
    const adapter = new FastifyAdapter({
      bodyLimit: 100 * 1024 * 1024,
    });

    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      adapter,
    );

    /* ---------------- FASTIFY INSTANCE ---------------- */
    const fastify = adapter.getInstance();

    // 🔥 Disable HTTP cache (Swagger always fresh)
    fastify.addHook('onSend', async (_req, reply) => {
      reply
        .header(
          'Cache-Control',
          'no-store, no-cache, must-revalidate, proxy-revalidate',
        )
        .header('Pragma', 'no-cache')
        .header('Expires', '0')
        .header('Surrogate-Control', 'no-store');
    });

    /* ---------------- FASTIFY PLUGINS ---------------- */
    await app.register(cookie);

    await app.register(multipart, {
      attachFieldsToBody: false,
      limits: {
        files: 50,
        fileSize: 20 * 1024 * 1024,
        fields: 100,
        fieldNameSize: 200,
      },
    });

    /* ---------------- MIDDLEWARES ---------------- */
    app.use(morgan('dev'));

    app.enableCors({
      origin: [
        'https://pkty.chuyendoisovn.com.vn',
        'https://pkty.gagiongsamoanh.com',
      ],
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'x-custom-lang'],
      credentials: true,
    });

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );

    app.setGlobalPrefix('api/v1');
    useContainer(app.select(AppModule), { fallbackOnErrors: true });

    /* ---------------- SWAGGER ---------------- */
    useSwagger(app);

    const port = app.get(ConfigService).get<number>('PORT') || 4002;
    await app.listen(port, '0.0.0.0');

    const url = await app.getUrl();
    console.log(`🚀 Application is running on ${url}`);
    console.log(`📘 Swagger: ${url}/api/docs`);
  } catch (err) {
    console.error('❌ Fatal error during bootstrap:', err);
    process.exit(1);
  }
}

bootstrap();
