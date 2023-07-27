import { Injectable, ExecutionContext } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';

@Injectable()
export class HttpDateCacheInterceptor extends CacheInterceptor {
  trackBy(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest();
    const { httpAdapter } = this.httpAdapterHost;
    const isGetRequest = httpAdapter.getRequestMethod(request) === 'GET';
    const requestUrl = httpAdapter.getRequestUrl(request);

    if (!isGetRequest) {
      return undefined;
    }

    const startDate = request.query.startDate || 'default';
    const endDate = request.query.endDate || 'default';
    return `${requestUrl}-${startDate}-${endDate}`;
  }
}
