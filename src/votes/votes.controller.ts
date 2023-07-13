import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  MSolVoteRecordsDto,
  MSolVoteSnapshotsDto,
  SnapshotsIntervalDto,
} from './votes.dto';
import { VotesService } from './votes.service';
import { HttpDateCacheInterceptor } from 'src/interceptors/date.interceptor';

@Controller('v1/votes/msol/')
@ApiTags('Votes')
@UseInterceptors(CacheInterceptor)
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Get('/latest')
  @ApiOperation({ summary: 'Fetch mSOL votes' })
  @ApiResponse({
    status: 200,
    description: 'The records are successfully fetched.',
    type: MSolVoteRecordsDto,
  })
  @CacheKey('mSOL votes')
  @CacheTTL(60e3)
  async getMsolBalanceFromLastSnaphot(): Promise<MSolVoteRecordsDto> {
    const result = await this.votesService.getLatestMSolVotes();
    if (!result) {
      throw new HttpException('No records available', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get('/all')
  @ApiOperation({ summary: 'Fetch all mSOL votes' })
  @ApiResponse({
    status: 200,
    description: 'The records are successfully fetched.',
    type: MSolVoteSnapshotsDto,
  })
  @UseInterceptors(HttpDateCacheInterceptor)
  @CacheTTL(60e3)
  async getMsolBalance(
    @Query() query: SnapshotsIntervalDto,
  ): Promise<MSolVoteSnapshotsDto> {
    if (query.startDate && query.endDate) {
      if (Date.parse(query.startDate) > Date.parse(query.endDate)) {
        throw new HttpException(
          'startDate is later than endDate',
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    const result = await this.votesService.getMSolVotes(
      query.startDate,
      query.endDate,
    );
    if (!result) {
      throw new HttpException('No records available', HttpStatus.NOT_FOUND);
    }

    return result;
  }
}
