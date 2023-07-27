import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  NativeStakeBalanceDto,
  SnapshotsIntervalDto,
} from '../snapshot/snapshot.dto';
import { HttpDateCacheInterceptor } from 'src/interceptors/date.interceptor';
import { StakersService } from './stakers.service';

@Controller('v1/stakers/')
@ApiTags('Stakers')
@UseInterceptors(CacheInterceptor)
export class StakersController {
  constructor(private readonly stakersService: StakersService) {}

  @Get('/ns/:pubkey')
  @ApiOperation({
    summary:
      'Fetch Native Stake balance for a pubkey for a specific date interval',
  })
  @ApiResponse({
    status: 200,
    description: 'The records were successfully fetched.',
    type: NativeStakeBalanceDto,
  })
  @UseInterceptors(HttpDateCacheInterceptor)
  @CacheTTL(60e3)
  async getNativeStakes(
    @Param('pubkey') pubkey: string,
    @Query() query: SnapshotsIntervalDto,
  ): Promise<NativeStakeBalanceDto[]> {
    if (query.startDate && query.endDate) {
      if (Date.parse(query.startDate) > Date.parse(query.endDate)) {
        throw new HttpException(
          'startDate is later than endDate',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    if (!query.startDate && !query.endDate) {
      throw new HttpException(
        'No startDate or endDate provided',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.stakersService.getNativeStakeBalances(
      query.startDate,
      query.endDate,
      pubkey,
    );
    if (!result) {
      throw new HttpException('Holder not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }
}
