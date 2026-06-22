import { IsArray, IsDateString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsValidDate } from 'src/decorators/snapshots-date.decorator';

export class MsolBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;
}

export class VeMNDEBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;
}

export class MsolBalanceHistoryItemDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;

  @IsDateString()
  @ApiProperty()
  snapshotCreatedAt: string;
}

export class VeMNDEBalanceHistoryItemDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;

  @IsDateString()
  @ApiProperty()
  snapshotCreatedAt: string;
}

export class NativeStakeBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;

  @IsDateString()
  @ApiProperty()
  snapshotCreatedAt: string;
}

export class AllNativeStakeBalancesDto {
  [owner: string]: NativeStakeBalanceDto[];
}

export class StakerBalancesDto {
  @ApiProperty()
  owner: string;

  @ApiProperty()
  @IsArray()
  balances: StakeBalanceDto[];
}

export class StakeBalanceDto {
  @IsNumber()
  @ApiProperty()
  liquid_amount: string;

  @IsNumber()
  @ApiProperty()
  native_amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;

  @IsDateString()
  @ApiProperty()
  snapshotCreatedAt: string;
}

export class SnapshotsIntervalDto {
  @ApiPropertyOptional({
    description:
      'Inclusive start of the range (YYYY-MM-DD). Defaults to one month before endDate.',
    example: '2026-05-01',
  })
  @IsOptional()
  @IsValidDate()
  startDate: string;

  @ApiPropertyOptional({
    description: 'Inclusive end of the range (YYYY-MM-DD). Defaults to now.',
    example: '2026-06-22',
  })
  @IsOptional()
  @IsValidDate()
  endDate: string;
}
