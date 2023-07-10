import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MSolVoteRecordsDto, VeMNDEVoteRecordsDto } from './votes.dto';
import { VotesService } from './votes.service';

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
    const result = await this.votesService.getSnapshotVeMNDEVotes();
    if (!result) {
      throw new HttpException('No records available', HttpStatus.NOT_FOUND);
    }

    return result;
  }
}
