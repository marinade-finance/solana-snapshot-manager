import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { RedocModule, RedocOptions } from 'nestjs-redoc';
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
    .build();
  const document = SwaggerModule.createDocument(app, options);
  const redocOptions: RedocOptions = {
    title: 'Marinade Snapshot API',
    logo: {
      url: 'https://marinade.finance/marinade-logo-black.svg',
    },
    sortPropsAlphabetically: true,
    hideDownloadButton: false,
    hideHostname: false,
    expandResponses: '200',
  };
  await RedocModule.setup('/docs', app, document, redocOptions);
  await app.listen(3000);
}
bootstrap();
