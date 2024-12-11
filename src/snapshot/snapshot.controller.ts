import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MsolBalanceDto, VeMNDEBalanceDto } from './snapshot.dto';
import { SnapshotService } from './snapshot.service';
import { StakersService } from 'src/stakers/stakers.service';

@Controller('v1/snapshot/latest')
@ApiTags('Snapshot')
@UseInterceptors(CacheInterceptor)
export class SnapshotController {
  constructor(
    private readonly snapshotService: SnapshotService,
    private readonly stakersService: StakersService,
  ) {}

  @Get('/msol/:pubkey')
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

  @Get('/vemnde/:pubkey')
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
}
