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
  AllNativeStakeBalancesDto,
  SnapshotsIntervalDto,
  AllStakeBalancesDto,
} from '../snapshot/snapshot.dto';
import { HttpDateCacheInterceptor } from 'src/interceptors/date.interceptor';
import { StakersService } from './stakers.service';
import { validateDateInterval } from 'src/util';

@Controller('v1/stakers/')
@ApiTags('Stakers')
@UseInterceptors(CacheInterceptor)
export class StakersController {
  constructor(private readonly stakersService: StakersService) {}
  @Get('/all/:pubkey')
  @ApiOperation({
    summary: 'Fetch all balances for a pubkey for a specific date interval',
  })
  @ApiResponse({
    status: 200,
    description: 'The records were successfully fetched.',
    type: AllStakeBalancesDto,
  })
  @UseInterceptors(HttpDateCacheInterceptor)
  @CacheTTL(60e3)
  async getAllStakes(
    @Param('pubkey') pubkey: string,
    @Query() query: SnapshotsIntervalDto,
  ): Promise<AllStakeBalancesDto> {
    validateDateInterval(query.startDate, query.endDate);
    const result = await this.stakersService.getAllStakeBalances(
      pubkey,
      query.startDate,
      query.endDate,
    );
    if (!result) {
      throw new HttpException('No holders found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get('/ns/all')
  @ApiOperation({
    summary: 'Fetch Native Stake balances for a specific date interval',
  })
  @ApiResponse({
    status: 200,
    description: 'The records were successfully fetched.',
    type: AllNativeStakeBalancesDto,
  })
  @UseInterceptors(HttpDateCacheInterceptor)
  @CacheTTL(60e3)
  async getAllNativeStakes(
    @Query() query: SnapshotsIntervalDto,
  ): Promise<AllNativeStakeBalancesDto> {
    validateDateInterval(query.startDate, query.endDate);
    const result = await this.stakersService.getAllNativeStakeBalances(
      query.startDate,
      query.endDate,
    );
    if (!result) {
      throw new HttpException('No holders found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

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
    validateDateInterval(query.startDate, query.endDate);
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
