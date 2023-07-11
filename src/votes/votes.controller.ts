import { Controller, Get, HttpException, HttpStatus, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MSolVoteRecordsDto } from './votes.dto';
import { VotesService } from './votes.service';

@Controller('v1/votes/msol/latest')
@ApiTags('Votes')
@UseInterceptors(CacheInterceptor)
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Get('/')
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

    return result
  }
}
