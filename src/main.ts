import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS
        .replace(/['"]/g, '') // Clean up double/single quotes from Docker env
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];

  console.log('CORS_ORIGINS:', corsOrigins.length ? corsOrigins : '[none]');

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin) {
        return callback(null, true);
      }

      // If CORS_ORIGINS is empty or contains '*', allow all
      if (corsOrigins.length === 0 || corsOrigins.includes('*')) {
        console.log(`CORS allow origin (open policy): ${origin}`);
        return callback(null, true);
      }

      const normalizedOrigin = origin.toLowerCase().trim();
      const isAllowed = corsOrigins.some((allowedOrigin) => {
        return allowedOrigin.toLowerCase().trim() === normalizedOrigin;
      });

      // Wildcard dynamic fallback for owned domains
      if (
        isAllowed || 
        normalizedOrigin.endsWith('.chuyendoisovn.com.vn') || 
        normalizedOrigin.endsWith('.gagiongsamoanh.com')
      ) {
        console.log(`CORS allow origin: ${origin}`);
        callback(null, true);
      } else {
        console.warn(`CORS blocked for origin: ${origin}`);
        callback(null, false);
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    // allowedHeaders is omitted so it reflects the requested headers automatically
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => {
        console.error('--- VALIDATION ERROR ---');
        errors.forEach((err) => {
          console.error(`Property: ${err.property}`);
          console.error(`Constraints:`, err.constraints);
        });
        console.error('------------------------');
        const messages = errors
          .map((error) => Object.values(error.constraints || {}))
          .flat();
        return new BadRequestException(messages);
      },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('The API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, documentFactory);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on port: ${port}`);
  logger.log(`Swagger documentation is available at: http://localhost:${port}/api/docs`);
}
bootstrap();
