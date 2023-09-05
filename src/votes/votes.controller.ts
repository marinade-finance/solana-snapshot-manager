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
  VeMNDEVoteRecordsDto,
  MSolVoteSnapshotsDto,
  SnapshotsIntervalDto,
} from './votes.dto';
import { VotesService } from './votes.service';
import { HttpDateCacheInterceptor } from 'src/interceptors/date.interceptor';
import { validateDateInterval } from 'src/util';

@Controller('v1/votes')
@ApiTags('Votes')
@UseInterceptors(CacheInterceptor)
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Get('/msol/latest')
  @ApiOperation({ summary: 'Fetch mSOL votes' })
  @ApiResponse({
    status: 200,
    description: 'The records are successfully fetched.',
    type: MSolVoteRecordsDto,
  })
  @CacheKey('mSOL votes')
  @CacheTTL(60e3)
  async getMsolVotesFromLastSnaphot(): Promise<MSolVoteRecordsDto> {
    const result = await this.votesService.getLatestMSolVotes();
    if (!result) {
      throw new HttpException('No records available', HttpStatus.NOT_FOUND);
    }

    return result;
  }

  @Get('/msol/all')
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
    validateDateInterval(query.startDate, query.endDate);

    const result = await this.votesService.getMSolVotes(
      query.startDate,
      query.endDate,
    );

    if (!result) {
      throw new HttpException('No records available', HttpStatus.NOT_FOUND);
    }
    return result;
  }

  @Get('/vemnde/latest')
  @ApiOperation({ summary: 'Fetch veMNDE votes' })
  @ApiResponse({
    status: 200,
    description: 'The records are successfully fetched.',
    type: VeMNDEVoteRecordsDto,
  })
  @CacheKey('veMNDE voting power')
  @CacheTTL(60e3)
  async getVeMNDEVotesFromLastSnaphot(): Promise<VeMNDEVoteRecordsDto> {
    const result = await this.votesService.getLatestveMNDEVotes();
    if (!result) {
      throw new HttpException('No records available', HttpStatus.NOT_FOUND);
    }

    return result;
  }
}
