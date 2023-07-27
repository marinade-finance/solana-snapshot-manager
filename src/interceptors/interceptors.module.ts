import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { HttpDateCacheInterceptor } from './date.interceptor';

@Module({
  imports: [CacheModule.register()],
  providers: [HttpDateCacheInterceptor],
})
export class InterceptorsModule {}
