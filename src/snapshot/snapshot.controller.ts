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
  MsolBalanceDto,
  MsolBalanceHistoryItemDto,
  SnapshotsIntervalDto,
  VeMNDEBalanceDto,
  VeMNDEBalanceHistoryItemDto,
} from './snapshot.dto';
import { SnapshotService } from './snapshot.service';
import { StakersService } from 'src/stakers/stakers.service';
import { HttpDateCacheInterceptor } from 'src/interceptors/date.interceptor';

@Controller('v1/snapshot')
@ApiTags('Snapshot')
@UseInterceptors(CacheInterceptor)
export class SnapshotController {
  constructor(
    private readonly snapshotService: SnapshotService,
    private readonly stakersService: StakersService,
  ) {}

  @Get('/latest/msol/:pubkey')
  @ApiOperation({ summary: 'Fetch mSOL balance for a pubkey' })
  @ApiResponse({
    status: 200,
    description: 'The record was successfully fetched.',
    type: MsolBalanceDto,
  })
  @CacheTTL(60e3)
  async getMsolBalanceFromLastSnaphot(
    @Param('pubkey') pubkey: string,
  ): Promise<MsolBalanceDto> {
    const result =
      await this.snapshotService.getMsolBalanceFromLastSnaphot(pubkey);
    if (!result) {
      throw new HttpException('Holder not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get('/latest/vemnde/:pubkey')
  @ApiOperation({ summary: 'Fetch VeMNDE balance for a pubkey' })
  @ApiResponse({
    status: 200,
    description: 'The record was successfully fetched.',
    type: VeMNDEBalanceDto,
  })
  @CacheTTL(60e3)
  async getVeMNDEBalanceFromLastSnaphot(
    @Param('pubkey') pubkey: string,
  ): Promise<VeMNDEBalanceDto> {
    const result =
      await this.snapshotService.getVeMNDEBalanceFromLastSnaphot(pubkey);
    if (!result) {
      throw new HttpException('Holder not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get('/history/msol/:pubkey')
  @ApiOperation({
    summary:
      'Fetch mSOL balance history for a pubkey over a date interval (defaults to the last month)',
  })
  @ApiResponse({
    status: 200,
    description: 'The records were successfully fetched.',
    type: [MsolBalanceHistoryItemDto],
  })
  @UseInterceptors(HttpDateCacheInterceptor)
  @CacheTTL(60e3)
  async getMsolBalanceHistory(
    @Param('pubkey') pubkey: string,
    @Query() query: SnapshotsIntervalDto,
  ): Promise<MsolBalanceHistoryItemDto[]> {
    if (
      query.startDate &&
      query.endDate &&
      Date.parse(query.startDate) > Date.parse(query.endDate)
    ) {
      throw new HttpException(
        'startDate is later than endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.snapshotService.getMsolBalanceHistory(
      pubkey,
      query.startDate,
      query.endDate,
    );
  }

  @Get('/history/vemnde/:pubkey')
  @ApiOperation({
    summary:
      'Fetch VeMNDE balance history for a pubkey over a date interval (defaults to the last month)',
  })
  @ApiResponse({
    status: 200,
    description: 'The records were successfully fetched.',
    type: [VeMNDEBalanceHistoryItemDto],
  })
  @UseInterceptors(HttpDateCacheInterceptor)
  @CacheTTL(60e3)
  async getVeMNDEBalanceHistory(
    @Param('pubkey') pubkey: string,
    @Query() query: SnapshotsIntervalDto,
  ): Promise<VeMNDEBalanceHistoryItemDto[]> {
    if (
      query.startDate &&
      query.endDate &&
      Date.parse(query.startDate) > Date.parse(query.endDate)
    ) {
      throw new HttpException(
        'startDate is later than endDate',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.snapshotService.getVeMNDEBalanceHistory(
      pubkey,
      query.startDate,
      query.endDate,
    );
  }
}
