import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MsolBalanceDto } from './snapshot.dto';
import { SnapshotService } from './snapshot.service';

@Controller('v1/snapshot/latest')
@ApiTags('Snapshot')
export class SnapshotController {
  constructor(private readonly snapshotService: SnapshotService) {}

  @Get('/msol/:pubkey')
  @ApiOperation({ summary: 'Fetch mSOL balance for a pubkey' })
  @ApiResponse({
    status: 200,
    description: 'The record was successfully fetched.',
    type: MsolBalanceDto,
  })
  async getMsolBalanceFromLastSnaphot(
    @Param('pubkey') pubkey: string,
  ): Promise<MsolBalanceDto> {
    const result = await this.snapshotService.getMsolBalanceFromLastSnaphot(
      pubkey,
    );
    if (!result) {
      throw new HttpException('Holder not found', HttpStatus.NOT_FOUND);
    }

    return result;
  }
}
