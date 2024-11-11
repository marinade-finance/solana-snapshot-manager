import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class IpLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IpLoggerInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { headers, url } = request;

    this.logger.log('Request Headers:', {
      url,
      requestIp: request.ip,
      headers,
    });

    return next.handle();
  }
}
