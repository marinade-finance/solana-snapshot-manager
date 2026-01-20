import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from './logger';
import { IpLoggerInterceptor } from './interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new Logger(),
    cors: true,
  });
  app.useGlobalInterceptors(new IpLoggerInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const options = new DocumentBuilder()
    .setTitle('Marinade Snapshot API')
    .setDescription(
      'This API serves data previsouly from previously processed snapshots.',
    )
    .setVersion('1.0')
    .setTermsOfService('/docs/swagger.json')
    .build();
  const document = SwaggerModule.createDocument(app, options);
  document.openapi = '3.1.0';
  SwaggerModule.setup('/docs', app, document);
  await app.listen(3000);
}
bootstrap();
